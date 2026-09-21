#!/bin/zsh
# สร้าง "PUKFU-POS.app" ตัวที่ดับเบิลคลิกแล้วร้านเปิด จากสองไฟล์ที่อยู่ข้างๆ นี้
#
# รันใหม่ทุกครั้งที่แก้ tools/launcher.applescript หรือ tools/pos-open.sh
# ไม่มีอะไรในระบบพึ่งแอปนี้ ลบทิ้งก็แค่เสียความสะดวก

set -eu
cd "$(dirname "$0")/.."

PROJECT="$PWD"
APP="$PROJECT/PUKFU-POS.app"
ICON_SRC="$PROJECT/icons/icon-512.png"

command -v osacompile > /dev/null || { echo "ไม่มี osacompile — ปกติมากับ macOS" >&2; exit 1; }

rm -rf "$APP"
osacompile -o "$APP" tools/launcher.applescript

cp tools/pos-open.sh "$APP/Contents/Resources/pos-open.sh"
chmod +x "$APP/Contents/Resources/pos-open.sh"

# ไอคอนบน Dock ใช้รูปเดียวกับไอคอนของเว็บแอป
if [ -f "$ICON_SRC" ]; then
  WORK="$(mktemp -d)/pukfupos.iconset"
  mkdir -p "$WORK"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" --out "$WORK/icon_${size}x${size}.png" > /dev/null
    sips -z "$((size * 2))" "$((size * 2))" "$ICON_SRC" --out "$WORK/icon_${size}x${size}@2x.png" > /dev/null
  done
  iconutil -c icns "$WORK" -o "$APP/Contents/Resources/applet.icns"
  rm -rf "$WORK"
fi

PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName 'PUKFU-POS'" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.pukfupos.launcher" "$PLIST" 2> /dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.pukfupos.launcher" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 1.0" "$PLIST" 2> /dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 1.0" "$PLIST"

# แก้ plist กับยัดไฟล์เข้าไปทำให้ลายเซ็นที่ osacompile ใส่มาใช้ไม่ได้
# macOS รุ่นใหม่ปฏิเสธแอปที่ลายเซ็นเสียไปเลย ต้องเซ็นใหม่แบบ ad-hoc
codesign --force --sign - "$APP" 2> /dev/null || true

# บอก Finder ให้เห็นไอคอนใหม่ ไม่งั้นจะขึ้นไอคอน applet เปล่าๆ
touch "$APP"

echo "สร้างแล้ว: $APP"
