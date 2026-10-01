# Promo media

Source for the video and images in `docs/media/`:

| File | What |
|---|---|
| `storyboard.html` | The 48 s promo as a seekable animation (1920 x 1080). Uses the real application screenshots in `docs/screenshots/` and a real Grad-CAM (`assets/`) produced by the released model. |
| `banner.html` | README banner (1600 x 400) and the GitHub social-preview image (1280 x 640). |
| `render.mjs` | Renders frames by seeking the animation (identical output on any machine) and encodes them with ffmpeg. |

```bash
# needs Chrome and an ffmpeg binary (e.g. `pip install imageio-ffmpeg`)
export PLAYWRIGHT_CHROMIUM_EXECUTABLE="C:/Program Files/Google/Chrome/Application/chrome.exe"
export FFMPEG=/path/to/ffmpeg
node render.mjs video ../../docs/media/meladx7-promo.mp4 ../../docs/media/meladx7-promo.gif
node render.mjs images ../../docs/media
```

Notes

* The video is silent on purpose: no licensed music or voice is bundled.
* The numbers on screen (1,675 test images, 82.45% accuracy, 0.735 macro-F1) are the released
  model's measured results; update `storyboard.html` if the model changes.
* The lesion image comes from the HAM10000 test split (CC BY-NC, Tschandl et al. 2018), shown
  with attribution in the video's end card and the banner. Non-commercial use only.
* Fonts: DM Sans and IBM Plex Mono (SIL Open Font License 1.1, via @fontsource).
* GitHub's social preview is set manually: repository **Settings, Social preview, Edit, Upload
  an image**, then pick `docs/media/social-preview.png`.
