"""Generate non-private media/GPS fixtures. Requires ffmpeg only for development tests."""
import subprocess
from pathlib import Path
root = Path('/private/tmp/dashcam-fixtures')
root.mkdir(parents=True, exist_ok=True)
for seq, start in [('000001', '120000'), ('000002', '120004')]:
    for channel, color, fps, tone in [('R', 'blue', 25, 220), ('F', 'green', 24, 440), ('C', 'red', 15, 880)]:
        path = root / f'NO20260923-{start}-{seq}{channel}.MP4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'color=c={color}:s=640x360:r={fps}:d=4', '-f', 'lavfi', '-i', f'sine=frequency={tone}:sample_rate=16000:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', str(fps), '-c:a', 'aac', '-shortest', '-y', str(path)], check=True)
rows = ['$V02']
for i in range(120):
    rows.append(f'{1790179200+i},A,{43.8+i*.00001},{-79.4+i*.00001},9000,{1000+i%20},1,2,3,NO20260923-120000-000001F.MP44,0,0,0')
(root / 'GPSData-fixture.txt').write_text('\n'.join(rows))
