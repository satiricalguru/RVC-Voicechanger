"""
models_manager.py — Scans, validates, indexes, and imports RVC voice models.
"""

import logging
import shutil
import threading
import urllib.request
import urllib.parse
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch

logger = logging.getLogger("models_manager")

APPLIO_META = {
    # Named model folders
    "Jett500epoch": {
        "name": "Jett", "icon": "JET",
        "category": "Valorant", "description": "Valorant's Jett with a fast, sharp profile",
        "bridge_pitch": 4,
    },
    "Satoru_GojoJP_e120_s5400": {
        "name": "Satoru Gojo", "icon": "GOJ",
        "category": "Anime", "description": "Jujutsu Kaisen inspired male anime tone",
        "bridge_pitch": 4,
    },
    "Donald-Trump_e135_s6480": {
        "name": "Donald Trump", "icon": "TRP",
        "category": "Public Figures", "description": "Public figure style voice profile",
        "bridge_pitch": -4,
    },
    "VT-TTS_Haruka": {
        "name": "Haruka", "icon": "HRK",
        "category": "Anime", "description": "Soft, clear Japanese female voice",
        "bridge_pitch": 6,
    },
    "VT-TTS_Hikari": {
        "name": "Hikari", "icon": "HIK",
        "category": "Anime", "description": "Bright, energetic anime-style voice",
        "bridge_pitch": 6,
    },
    # IVF-prefixed index folders for the same voices
    "IVF589_Flat_Jetttest": {
        "name": "Jett", "icon": "JET",
        "category": "Valorant", "description": "Valorant's Jett with a fast, sharp profile",
        "bridge_pitch": 4,
    },
    "IVF673_Flat_Satoru_GojoJP": {
        "name": "Satoru Gojo", "icon": "GOJ",
        "category": "Anime", "description": "Jujutsu Kaisen inspired male anime tone",
        "bridge_pitch": 4,
    },
    "IVF1408_Flat_Donald-Trump": {
        "name": "Donald Trump", "icon": "TRP",
        "category": "Public Figures", "description": "Public figure style voice profile",
        "bridge_pitch": -4,
    },
    "IVF1327_Flat_VT-TTS_Haruka": {
        "name": "Haruka", "icon": "HRK",
        "category": "Anime", "description": "Soft, clear Japanese female voice",
        "bridge_pitch": 6,
    },
    "IVF1344_Flat_VT-TTS_Hikari": {
        "name": "Hikari", "icon": "HIK",
        "category": "Anime", "description": "Bright, energetic anime-style voice",
        "bridge_pitch": 6,
    },
}


class ModelsManager:
    def __init__(self, models_dir: str = "models"):
        self.models_dir = Path(models_dir)
        self.default_dir = self.models_dir / "default"
        self.custom_dir = self.models_dir / "custom"
        self.custom_dir.mkdir(parents=True, exist_ok=True)
        self.image_dir = self.models_dir / "images"
        self.image_dir.mkdir(parents=True, exist_ok=True)
        self._downloading_images = set()
        self._voices: List[Dict] = []
        self._index_voices()

    def _normalize_key(self, text: str) -> str:
        return "".join(ch for ch in text.lower() if ch.isalnum())

    def _find_index_file(self, base_dir: Path, model_name: str) -> Optional[str]:
        needle = self._normalize_key(model_name)
        best_match = None
        for candidate in base_dir.rglob("*.index"):
            cand_key = self._normalize_key(candidate.stem)
            if needle and (needle[:8] in cand_key or cand_key[:8] in needle):
                best_match = candidate
                break
        return str(best_match) if best_match else None

    def _generate_logo(self, name: str) -> str:
        parts = [chunk[:1].upper() for chunk in name.replace("-", " ").replace("_", " ").split()[:3]]
        return "".join(parts) or "RVC"

    def _extract_metadata(self, pth_path: Path) -> Dict:
        metadata = {
            "speaker": pth_path.stem.replace("_", " ").title(),
            "version": "unknown",
            "sample_rate": None,
            "training_steps": None,
            "size_mb": round(pth_path.stat().st_size / 1024 / 1024, 1),
            "has_index": False,
        }
        try:
            # Prefer weights_only=True (safe against pickle exploits in malicious .pth
            # files).  Metadata keys (config, sr, f0, version) are plain Python types
            # so this works for well-formed checkpoints.  Fall back to False only for
            # older checkpoints that embed custom Python objects in the metadata.
            try:
                checkpoint = torch.load(str(pth_path), map_location="cpu", weights_only=True)
            except Exception:
                logger.warning(
                    "weights_only=True failed for %s — falling back to unsafe load. "
                    "Only load models from sources you trust.",
                    pth_path.name,
                )
                checkpoint = torch.load(str(pth_path), map_location="cpu", weights_only=False)
            metadata["version"] = str(checkpoint.get("version", "v1"))
            metadata["speaker"] = str(
                checkpoint.get("speaker_info")
                or checkpoint.get("name")
                or checkpoint.get("model_name")
                or metadata["speaker"]
            )
            metadata["sample_rate"] = checkpoint.get("sr")
            config = checkpoint.get("config")
            if isinstance(config, list) and len(config) > 16 and metadata["sample_rate"] is None:
                metadata["sample_rate"] = config[16]
            metadata["training_steps"] = checkpoint.get("step") or checkpoint.get("steps")
        except Exception as exc:
            raise ValueError(f"Invalid PyTorch checkpoint: {exc}") from exc
        return metadata

    def _get_ddg_image_urls(self, query: str) -> List[str]:
        try:
            ddg_url = f"https://duckduckgo.com/?q={urllib.parse.quote(query)}"
            req = urllib.request.Request(ddg_url, headers={
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            })
            with urllib.request.urlopen(req, timeout=5) as response:
                content = response.read().decode('utf-8')
                vqd_match = re.search(r'vqd=[\'"]?([^\'&"]+)[\'"]?', content)
                if not vqd_match:
                    vqd_match = re.search(r'vqd\s*[:=]\s*[\'"]?([^\'&"]+)[\'"]?', content)
                if vqd_match:
                    vqd = vqd_match.group(1)
                    image_search_url = f"https://duckduckgo.com/i.js?q={urllib.parse.quote(query)}&o=json&vqd={vqd}"
                    req_img = urllib.request.Request(image_search_url, headers={
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Referer': 'https://duckduckgo.com/'
                    })
                    with urllib.request.urlopen(req_img, timeout=5) as img_resp:
                        img_data = json.loads(img_resp.read().decode('utf-8'))
                        results = img_data.get("results", [])
                        return [r.get("image") for r in results if r.get("image")]
        except Exception as e:
            logger.warning("DuckDuckGo image search error for query '%s': %s", query, e)
        return []

    def _get_wikipedia_image_url(self, query: str) -> Optional[str]:
        try:
            search_url = f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(query)}&utf8=&format=json"
            req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode('utf-8'))
                search_results = data.get("query", {}).get("search", [])
                if not search_results:
                    return None
                title = search_results[0]["title"]

            image_url = f"https://en.wikipedia.org/w/api.php?action=query&titles={urllib.parse.quote(title)}&prop=pageimages&format=json&pithumbsize=250"
            req = urllib.request.Request(image_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode('utf-8'))
                pages = data.get("query", {}).get("pages", {})
                for page_id, page_data in pages.items():
                    thumbnail = page_data.get("thumbnail", {}).get("source")
                    if thumbnail:
                        return thumbnail
        except Exception:
            pass
        return None

    def _trigger_image_download(self, voice_id: str, name: str):
        if voice_id in self._downloading_images:
            return
        self._downloading_images.add(voice_id)

        def run():
            try:
                query = name
                img_urls = self._get_ddg_image_urls(query)
                if not img_urls and "_" in query:
                    img_urls = self._get_ddg_image_urls(query.replace("_", " "))
                if not img_urls:
                    img_urls = self._get_ddg_image_urls(f"{query} voice")

                downloaded = False
                for img_url in img_urls[:5]:
                    try:
                        req = urllib.request.Request(img_url, headers={
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        })
                        with urllib.request.urlopen(req, timeout=8) as response:
                            img_data = response.read()
                            if len(img_data) > 1000:
                                out_path = self.image_dir / f"{voice_id}.jpg"
                                out_path.write_bytes(img_data)
                                logger.info("Successfully downloaded image for %s (%s) from %s", name, voice_id, img_url)
                                downloaded = True
                                break
                    except Exception as download_err:
                        logger.warning("Failed to download from %s: %s. Trying next...", img_url, download_err)

                if not downloaded:
                    wiki_url = self._get_wikipedia_image_url(query)
                    if wiki_url:
                        try:
                            req = urllib.request.Request(wiki_url, headers={
                                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                            })
                            with urllib.request.urlopen(req, timeout=8) as response:
                                img_data = response.read()
                                if len(img_data) > 1000:
                                    out_path = self.image_dir / f"{voice_id}.jpg"
                                    out_path.write_bytes(img_data)
                                    logger.info("Successfully downloaded image for %s (%s) from Wikipedia: %s", name, voice_id, wiki_url)
                                    downloaded = True
                        except Exception as wiki_err:
                            logger.warning("Failed to download Wikipedia image for %s: %s", name, wiki_err)
            except Exception as e:
                logger.warning("Failed to download image for %s (%s): %s", name, voice_id, e)
            finally:
                self._downloading_images.discard(voice_id)

        threading.Thread(target=run, daemon=True).start()

    def _voice_entry(
        self,
        voice_id: str,
        source: str,
        path: Optional[str],
        index_path: Optional[str],
        name: str,
        icon: str,
        category: str,
        description: str,
        metadata: Optional[Dict] = None,
    ) -> Dict:
        meta = metadata or {}
        img_filename = f"{voice_id}.jpg"
        img_local_path = self.image_dir / img_filename
        has_image = img_local_path.exists()

        if voice_id != "original" and source in ("custom", "rvc") and not has_image:
            self._trigger_image_download(voice_id, name)

        return {
            "id": voice_id,
            "name": name,
            "icon": icon,
            "category": category,
            "description": description,
            "source": source,
            "path": path,
            "index": index_path,
            "size_mb": meta.get("size_mb", 0),
            "speaker": meta.get("speaker", name),
            "version": meta.get("version", "unknown"),
            "sample_rate": meta.get("sample_rate"),
            "training_steps": meta.get("training_steps"),
            "has_index": bool(index_path),
            # Semitone offset applied in engine.select_voice to compensate for model
            # training pitch.  Stored in APPLIO_META; defaults to 4 for unknown models.
            "bridge_pitch": meta.get("bridge_pitch", 4),
            "image": f"/api/images/{img_filename}" if has_image else None,
        }

    def _index_voices(self):
        self._voices = [
            self._voice_entry(
                "original",
                "system",
                None,
                None,
                "Original",
                "MIC",
                "No Effect",
                "Your dry microphone input with no conversion applied.",
            )
        ]

        if self.default_dir.exists():
            for pth_file in sorted(self.default_dir.rglob("*.pth")):
                meta_hint = APPLIO_META.get(pth_file.parent.name) or APPLIO_META.get(pth_file.stem, {})
                try:
                    extracted = self._extract_metadata(pth_file)
                except Exception as exc:
                    logger.warning("Skipping invalid default model %s: %s", pth_file, exc)
                    continue
                index_path = self._find_index_file(self.default_dir, pth_file.stem)
                self._voices.append(self._voice_entry(
                    voice_id=f"default_{pth_file.parent.name}",
                    source="rvc",
                    path=str(pth_file),
                    index_path=index_path,
                    name=meta_hint.get("name", extracted["speaker"]),
                    icon=meta_hint.get("icon", self._generate_logo(extracted["speaker"])),
                    category=meta_hint.get("category", "RVC"),
                    description=meta_hint.get("description", f"RVC voice model: {pth_file.stem}"),
                    metadata={**extracted, "bridge_pitch": meta_hint.get("bridge_pitch", 4)},
                ))

        for pth_file in sorted(self.custom_dir.glob("*.pth")):
            try:
                extracted = self._extract_metadata(pth_file)
            except Exception as exc:
                logger.warning("Skipping invalid custom model %s: %s", pth_file, exc)
                continue
            index_path = self._find_index_file(self.custom_dir, pth_file.stem)
            self._voices.append(self._voice_entry(
                voice_id=f"custom_{pth_file.stem}",
                source="custom",
                path=str(pth_file),
                index_path=index_path,
                name=extracted["speaker"],
                icon=self._generate_logo(extracted["speaker"]),
                category="My Voices",
                description=f"Imported custom RVC model ({extracted['size_mb']} MB)",
                metadata=extracted,
            ))

        logger.info("Indexed %s voices", len(self._voices))

    def get_voice_list(self) -> List[Dict]:
        for voice in self._voices:
            if not voice.get("image") and voice["id"] != "original":
                img_filename = f"{voice['id']}.jpg"
                if (self.image_dir / img_filename).exists():
                    voice["image"] = f"/api/images/{img_filename}"
        return list(self._voices)

    def get_voice_by_id(self, voice_id: str) -> Optional[Dict]:
        voice = next((v for v in self._voices if v["id"] == voice_id), None)
        if voice and not voice.get("image") and voice["id"] != "original":
            img_filename = f"{voice['id']}.jpg"
            if (self.image_dir / img_filename).exists():
                voice["image"] = f"/api/images/{img_filename}"
        return voice

    def validate_model_upload(self, pth_bytes: bytes, pth_name: str, index_name: Optional[str] = None) -> Dict:
        temp_path = self.custom_dir / f".validate_{Path(pth_name).name}"
        temp_path.write_bytes(pth_bytes)
        try:
            metadata = self._extract_metadata(temp_path)
            metadata["has_index"] = bool(index_name)
            return metadata
        finally:
            temp_path.unlink(missing_ok=True)

    def save_custom_model(
        self,
        pth_bytes: bytes,
        pth_name: str,
        index_bytes: Optional[bytes] = None,
        index_name: Optional[str] = None,
    ) -> Dict:
        safe_name = Path(pth_name).stem.replace(" ", "_")
        validated = self.validate_model_upload(pth_bytes, safe_name, index_name=index_name)
        pth_path = self.custom_dir / f"{safe_name}.pth"
        pth_path.write_bytes(pth_bytes)

        if index_bytes:
            (self.custom_dir / f"{safe_name}.index").write_bytes(index_bytes)
        elif index_name:
            shutil.copy2(index_name, self.custom_dir / f"{safe_name}.index")

        self._index_voices()
        voice = self.get_voice_by_id(f"custom_{safe_name}") or {}
        voice["validation"] = validated
        return voice

    def import_model_files(self, pth_path: str, index_path: Optional[str] = None, model_name: Optional[str] = None) -> Dict:
        src_pth = Path(pth_path)
        if not src_pth.exists():
            raise FileNotFoundError(f"Model file not found: {pth_path}")
        safe_name = Path(model_name or src_pth.stem).stem.replace(" ", "_")
        validated = self._extract_metadata(src_pth)

        dst_pth = self.custom_dir / f"{safe_name}.pth"
        shutil.copy2(src_pth, dst_pth)

        resolved_index = index_path or self._find_index_file(src_pth.parent, src_pth.stem)
        if resolved_index:
            shutil.copy2(resolved_index, self.custom_dir / f"{safe_name}.index")

        self._index_voices()
        voice = self.get_voice_by_id(f"custom_{safe_name}") or {}
        voice["validation"] = validated
        return voice

    def delete_custom_model(self, voice_id: str) -> bool:
        voice = self.get_voice_by_id(voice_id)
        if not voice or voice["source"] != "custom":
            return False
        try:
            if voice.get("path"):
                Path(voice["path"]).unlink(missing_ok=True)
            if voice.get("index"):
                Path(voice["index"]).unlink(missing_ok=True)
            (self.image_dir / f"{voice_id}.jpg").unlink(missing_ok=True)
            self._index_voices()
            return True
        except Exception as exc:
            logger.error("Delete model error: %s", exc)
            return False

    def refresh(self):
        self._index_voices()

    def get_categories(self) -> List[str]:
        seen: List[str] = []
        for voice in self._voices:
            category = voice["category"]
            if category not in seen:
                seen.append(category)
        return seen
