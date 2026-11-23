"""Assert Android launch and assistant navigation; retain diagnostics on failure."""
import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(os.environ.get('GITHUB_WORKSPACE', '.'))
HOST = 'sonora-web-api-production.up.railway.app'

def adb(*args, check=True):
    return subprocess.run(['adb', *args], capture_output=True, check=check, timeout=40)

def screenshot(name):
    (OUT / name).write_bytes(adb('exec-out', 'screencap', '-p').stdout)

def hierarchy():
    adb('shell', 'uiautomator', 'dump', '/sdcard/sonora-ui.xml')
    raw = adb('shell', 'cat', '/sdcard/sonora-ui.xml').stdout
    (OUT / 'sonora-android-ui.xml').write_bytes(raw)
    return ET.fromstring(raw)

try:
    # ICMP may be blocked. A resolved PING header tests DNS independently of echo replies.
    resolved = False
    probes = []
    for attempt in range(6):
        probe = adb('shell', 'ping', '-c', '1', '-W', '2', HOST, check=False)
        text = (probe.stdout + probe.stderr).decode(errors='replace')
        probes.append(text)
        if re.search(r'PING .*\([0-9a-fA-F:.]+\)', text):
            resolved = True
            break
        time.sleep(3)
    (OUT / 'sonora-android-network.txt').write_text('\n'.join(probes))
    adb('install', '-r', 'apps/android/app/build/outputs/apk/debug/app-debug.apk')
    adb('shell', 'am', 'force-stop', 'app.sonora.android')
    adb('shell', 'am', 'start', '-W', '-n', 'app.sonora.android/.MainActivity')
    target = None
    for attempt in range(10):
        tree = hierarchy()
        target = next((node for node in tree.iter('node') if 'Помощник SONORA' in node.get('text', '')), None)
        if target is not None:
            break
        time.sleep(2)
    screenshot('sonora-android-start.png')
    assert target is not None, 'SONORA home/assistant entry did not appear'
    bounds = [int(n) for n in re.findall(r'\d+', target.get('bounds', ''))]
    assert len(bounds) == 4, 'Assistant entry has no valid bounds'
    adb('shell', 'input', 'tap', str((bounds[0]+bounds[2])//2), str((bounds[1]+bounds[3])//2))
    text = ''
    for attempt in range(5):
        text = ' '.join(node.get('text', '') for node in hierarchy().iter('node'))
        if 'Я — музыкальный помощник SONORA' in text:
            break
        time.sleep(1)
    screenshot('sonora-android-assistant.png')
    assert 'Я — музыкальный помощник SONORA' in text, 'Assistant introduction missing'
    assert 'Сказать' in text and 'Подобрать' in text, 'Assistant input controls missing'
    assert resolved, 'Emulator DNS unavailable; see sonora-android-network.txt. UI launch alone is insufficient.'
    (OUT / 'sonora-android-result.txt').write_text('PASS: DNS, home, assistant introduction and input controls. Speech and playback not tested.\n')
finally:
    (OUT / 'sonora-android-activity.txt').write_bytes(adb('shell', 'dumpsys', 'activity', 'activities', check=False).stdout)
    (OUT / 'sonora-android-logcat.txt').write_bytes(adb('logcat', '-d', '-t', '400', check=False).stdout)
