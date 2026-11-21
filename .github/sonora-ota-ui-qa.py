import re
import subprocess
import time
import xml.etree.ElementTree as ET


PACKAGE = "app.sonora.android"
UI_PATH = "/data/local/tmp/sonora-ota-ui.xml"


def adb(*args, timeout=30):
    return subprocess.check_output(["adb", *args], text=True, timeout=timeout).strip()


def shell(*args):
    return adb("shell", *args)


def nodes():
    try:
        result = shell("uiautomator", "dump", UI_PATH)
        if "dumped" not in result:
            return []
        return list(ET.fromstring(shell("cat", UI_PATH)).iter("node"))
    except (ET.ParseError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return []


def label(node):
    return node.get("text") or node.get("content-desc") or ""


def find(choices, timeout=30, optional=False):
    deadline = time.monotonic() + timeout
    visible = []
    while time.monotonic() < deadline:
        visible = nodes()
        for choice in choices:
            for node in visible:
                if label(node).casefold() == choice.casefold():
                    points = [int(value) for value in re.findall(r"\d+", node.get("bounds", ""))]
                    if len(points) == 4 and points[0] < points[2] and points[1] < points[3]:
                        return choice, points
        time.sleep(1)
    if optional:
        return None
    raise AssertionError(f"Expected {choices}. Visible: {[label(n) for n in visible if label(n)]}")


def tap(match):
    name, (left, top, right, bottom) = match
    shell("input", "tap", str((left + right) // 2), str((top + bottom) // 2))
    print(f"Tapped {name}", flush=True)


def open_updates():
    shell("am", "start", "-W", "-n", f"{PACKAGE}/.MainActivity")
    tap(find(("Настройки",)))
    size = re.findall(r"(\d+)x(\d+)", shell("wm", "size"))[-1]
    width, height = map(int, size)
    target = ("Информация и поддержка",)
    for _ in range(3):
        match = find(target, timeout=5, optional=True)
        if match:
            tap(match)
            break
        shell("input", "swipe", str(width // 2), str(int(height * .76)),
              str(width // 2), str(int(height * .26)), "400")
    else:
        tap(find(target))
    tap(find(("Проверить", "Проверить ещё раз")))


def version():
    match = re.search(r"\bversionCode=(\d+)", shell("dumpsys", "package", PACKAGE))
    return int(match.group(1)) if match else None


def main():
    adb("install", "-r", "apps/android/app/build/outputs/apk/release/app-release.apk", timeout=90)
    assert version() == 199
    open_updates()
    find(("Доступно обновление SONORA",))
    visible = [label(n) for n in nodes()]
    assert any("Версия 0.1.200" in text and "0.1.199" in text for text in visible), visible
    print("Manual check offered 0.1.200 over 0.1.199.", flush=True)
    tap(find(("Обновить",)))

    action = find(("Открыть настройки", "Update", "Install", "Обновить приложение", "Установить"),
                  timeout=100)
    if action[0] == "Открыть настройки":
        tap(action)
        tap(find(("Allow from this source", "Разрешить из этого источника", "Разрешить установку из этого источника")))
        shell("input", "keyevent", "KEYCODE_BACK")
        action = find(("Update", "Install", "Обновить приложение", "Установить"), timeout=45)
    tap(action)
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline and version() != 200:
        time.sleep(2)
    assert version() == 200, version()
    print("System Package Installer updated SONORA to 0.1.200.", flush=True)

    open_updates()
    find(("Обновления SONORA",))
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        visible = [label(n) for n in nodes()]
        if any(text.startswith("Последняя проверка:") for text in visible):
            assert not any(text.startswith("Доступно обновление") for text in visible), visible
            print("Manual check after installation did not offer 0.1.200 again.", flush=True)
            break
    else:
        raise AssertionError(f"No completed post-update check: {visible}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Visible:", [label(n) for n in nodes() if label(n)], flush=True)
        print(shell("logcat", "-d", "-t", "200", "-s",
                    "WM-WorkerWrapper", "WM-SystemFgDispatcher", "AndroidRuntime"), flush=True)
        raise
