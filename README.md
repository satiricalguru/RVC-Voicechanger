<div align="center">
  <img src="assets/icon.png" alt="RVC Voicechanger Logo" width="180" />

  # RVC Voicechanger

  <p align="center">
    <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-v33.0.0-blue.svg?style=flat-square&logo=electron" alt="Electron" /></a>
    <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/FastAPI-v0.136.0-green.svg?style=flat-square&logo=fastapi" alt="FastAPI" /></a>
    <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-v16.2.4-black.svg?style=flat-square&logo=nextdotjs" alt="Next.js" /></a>
    <a href="https://pytorch.org/"><img src="https://img.shields.io/badge/PyTorch-v2.0%2B-ee4c2c.svg?style=flat-square&logo=pytorch" alt="PyTorch" /></a>
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License" />
  </p>

  <p align="center">
    <strong>A premium, real-time AI voice changer desktop application powered by Retrieval-based Voice Conversion (RVC) and Pedalboard DSP.</strong><br />
    Experience near-zero latency conversion, automated image scraping for models, and customizable preset controls in a beautiful glassmorphic dark-mode interface.
  </p>
</div>

---

## 🌟 Key Features

*   **Real-time AI Voice Conversion:** Highly optimized local RVC pipeline utilizing PyTorch, ONNX, and torchfcpe for pitch extraction.
*   **Integrated DSP Pedalboard:** Embedded real-time noise gate, highpass filter, compressor, pitch shifter, and reverb powered by Spotify's `pedalboard` library.
*   **Automatic Web Image Scraper:** Automatically scans `.pth` and `.index` model names to scrape, cache, and display high-quality model avatars from DuckDuckGo and Wikipedia.
*   **One-Click RVC Import:** Seamlessly import custom Applio voice models via a drag-and-drop local import interface.
*   **Compact Model Manager:** Star your favorite models or delete custom presets directly from the grid.
*   **Clean Mode Bypass:** Select the **Original** voice to bypass the DSP chain entirely and route your clean microphone audio directly.
*   **Low Latency & High Performance:** Tailored multi-threaded pipeline with macOS OpenMP conflict mitigation for smooth performance on Apple Silicon.

---

## 📸 Screenshots

*Screenshots will be added here.*

---

## 🏗️ Architecture & Workflow

The application runs a hybrid desktop architecture: a modern React frontend hosted locally by a Python FastAPI server, all orchestrated within an Electron shell.

```mermaid
graph TD
    A[Electron Shell] <-->|IPC Bridge| B[Next.js Renderer UI]
    A -->|Spawns / Manages| C[FastAPI Python Backend]
    B <-->|REST / WebSockets| C
    C -->|Audio Streaming| D[Sounddevice Input/Output]
    C -->|AI Inference| E[RVC Inference Pipeline]
    C -->|Audio Effects| F[Spotify Pedalboard DSP]
    C -->|Model Manager| G[Web Image Scraper & Disk Cacher]
```

---

## 🛠️ Technology Stack

*   **Frontend Shell:** [Electron](https://www.electronjs.org/), JavaScript
*   **User Interface:** React, [Next.js](https://nextjs.org/), Tailwind CSS, Lucide Icons, Shadcn UI
*   **Backend Server:** [FastAPI](https://fastapi.tiangolo.com/), Uvicorn, WebSockets
*   **Audio Engine:** PySoundDevice, Spotify Pedalboard, PyTorch, FAISS, Librosa

---

## 🚀 Getting Started

### Prerequisites

*   **Node.js:** v18.x or later (pnpm recommended)
*   **Python:** v3.10 to v3.12 (with pip and venv)

### Installation

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/satiricalguru/RVC-Voicechanger.git
    cd rvc-voicechanger
    ```

2.  **Set Up the Python Virtual Environment:**
    ```bash
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    ```

3.  **Install Frontend Dependencies:**
    ```bash
    cd ui
    pnpm install
    cd ..
    ```

4.  **Install Electron Shell Dependencies:**
    ```bash
    pnpm install
    ```

### Running the Application

*   **Development Mode:**
    ```bash
    npm run dev
    ```
    This launches the FastAPI backend locally, boots the hot-reloaded Next.js client, and opens the Electron desktop window.

*   **Production Build & Start:**
    ```bash
    npm start
    ```

### Packaging the Application

Compile the app bundle into a standalone executable (e.g., `.dmg` on macOS, `.exe` on Windows):
```bash
npm run build
```

---

## 📂 Folder Structure

```
.
├── app/                  # FastAPI Backend API
│   ├── backend/          # Models Manager, Engine, and RVC Pipeline
│   └── frontend/         # Static compiled Next.js bundle
├── assets/               # Branding assets & application icons
├── electron/             # Main process & IPC handler definitions
├── ui/                   # Next.js / Tailwind React components
├── models/               # RVC Models folder
│   ├── applio/           # Native pre-installed RVC checkpoints
│   ├── custom/           # User imported .pth / .index files
│   └── images/           # Cached scraped web avatars
├── requirements.txt      # Python dependencies
└── package.json          # Node scripts and Electron configuration
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
