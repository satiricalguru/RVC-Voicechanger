from PIL import Image, ImageDraw, ImageFilter

def main():
    # 1. Load the original high-res logo from the artifacts directory to avoid degradation
    orig = Image.open("/Users/jatinpandey/.gemini/antigravity-ide/brain/ca5e7c5c-112f-4e38-bbd1-1d56d03d2acd/rvc_logo_icon_1782992911225.png").convert("RGBA")
    
    # 2. Extract the white drawing
    gray = orig.convert("L")
    mask = gray.point(lambda p: p if p > 30 else 0)
    
    white_img = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
    logo = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    logo.paste(white_img, (0, 0), mask=mask)
    
    bbox = mask.getbbox()
    if bbox:
        logo_cropped = logo.crop(bbox)
        logo_w, logo_h = logo_cropped.size
        # Proportional brand mark size (560px for the 872px squircle)
        ratio = min(560 / logo_w, 560 / logo_h)
        new_w = int(logo_w * ratio)
        new_h = int(logo_h * ratio)
        logo_resized = logo_cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    else:
        logo_resized = logo.resize((560, 560), Image.Resampling.LANCZOS)
        new_w, new_h = 560, 560
        
    # 3. Create the macOS app icon background (1024x1024, transparent)
    mac_icon = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    
    # Draw soft drop shadow (offset down, blurred black squircle)
    # The squircle is centered at [76, 76, 948, 948] (size 872x872)
    shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle([72, 84, 952, 958], radius=240, fill=(0, 0, 0, 150))
    shadow_blurred = shadow.filter(ImageFilter.GaussianBlur(24))
    mac_icon.paste(shadow_blurred, (0, 0), mask=shadow_blurred)
    
    # Create a vertical linear gradient for the squircle background
    gradient = Image.new("RGBA", (1024, 1024))
    for y in range(1024):
        t = y / 1024.0
        # Slate gray (#3a3a42) to deep black (#0b0b0d)
        r = int(58 * (1.0 - t) + 11 * t)
        g = int(58 * (1.0 - t) + 11 * t)
        b = int(66 * (1.0 - t) + 13 * t)
        for x in range(1024):
            gradient.putpixel((x, y), (r, g, b, 255))
            
    # Create squircle mask
    mask_squircle = Image.new("L", (1024, 1024), 0)
    mask_draw = ImageDraw.Draw(mask_squircle)
    mask_draw.rounded_rectangle([76, 76, 948, 948], radius=240, fill=255)
    
    # Paste gradient using the squircle mask
    mac_icon.paste(gradient, (0, 0), mask=mask_squircle)
    
    # Paste logo in the center of the squircle
    logo_x = (1024 - new_w) // 2
    logo_y = (1024 - new_h) // 2
    mac_icon.paste(logo_resized, (logo_x, logo_y), mask=logo_resized)
    
    # Save the updated PNG icon
    mac_icon.save("/Users/jatinpandey/Antigravity/AiVoiceChanger/assets/icon.png")
    print("New updated macOS squircle icon created with perfect size and margins!")

if __name__ == '__main__':
    main()
