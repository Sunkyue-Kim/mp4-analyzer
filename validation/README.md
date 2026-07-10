# Validation Media

Files under `validation/generated/` are ordinary GitHub Pages assets and parser regression fixtures.

## Moving high-detail AVC patch

`avc_moving_detail_patch.mp4` is a 5-second, 1280x720, 30 fps AVC sample. A 192x192 high-frequency patch moves over a nearly flat background, creating a strong spatial-complexity contrast for future codec-syntax partition and regional bit-allocation work.

The current frame-internals heatmap does not decode exact regional entropy or partition syntax. The sample is therefore useful today for frame-size, playback-overlay, and parser regression checks, but the estimated hot cells must not be interpreted as the encoded patch's exact block bits.

```powershell
ffmpeg -y -f lavfi -i "color=c=0x243447:s=1280x720:r=30:d=5" -f lavfi -i "testsrc2=s=192x192:r=30:d=5" -filter_complex "[0:v]format=yuv420p[background];[1:v]noise=alls=80:allf=t+u,eq=contrast=1.45:saturation=1.35,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.9:t=3[detail];[background][detail]overlay=x='40+(W-w-80)*t/5':y='(H-h)/2+180*sin(2*PI*t/2.5)':shortest=1,format=yuv420p[video]" -map "[video]" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -g 30 -keyint_min 30 -bf 2 -x264-params "scenecut=0" -movflags +faststart -an validation/generated/avc_moving_detail_patch.mp4
```

## 4K HEVC

`hevc_4k_5s.mp4` is a 5-second, 3840x2160, 24 fps HEVC Main sample with 64x64 CTUs, a fixed 24-frame GOP, and B-frames.

```powershell
ffmpeg -y -f lavfi -i "testsrc2=s=3840x2160:r=24:d=5" -c:v libx265 -preset ultrafast -crf 28 -pix_fmt yuv420p -tag:v hvc1 -g 24 -keyint_min 24 -bf 2 -x265-params "keyint=24:min-keyint=24:scenecut=0:bframes=2:pools=8:ctu=64:min-cu-size=8" -movflags +faststart -an validation/generated/hevc_4k_5s.mp4
```
