#!/bin/zsh
# เปิด PUKFU-POS ที่อยู่บนเว็บ โดยไม่ต้องไปหาที่คั่นหน้าเอง
#
# ถูกเรียกจาก "PUKFU-POS.app" อะไรที่สคริปต์นี้พิมพ์ออกมาจะไปโผล่เป็นกล่องข้อความของแอป
#
# ตัวนี้ไม่ได้เปิดเครื่องให้บริการในเครื่องเหมือน PeePukFu เพราะหน้าเว็บอยู่บน GitHub Pages อยู่แล้ว
# หน้าที่เดียวของมันคือพาไปที่เดิมทุกครั้ง

set -u
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

URL="https://karmoo-blip.github.io/PUKFU-POS/"

# ถ้าติดตั้งเป็นแอปไว้แล้ว ให้เปิดตัวที่ติดตั้ง ไม่ใช่แท็บในเบราว์เซอร์
# บิลที่ค้างซิงก์ตอนเน็ตหลุดเก็บอยู่ใน localStorage ของที่ที่เปิดไว้ เปิดคนละที่จะไม่เห็นของค้างนั้น
for CANDIDATE in \
  "$HOME/Applications/PUKFU POS.app" \
  "$HOME/Applications/Chrome Apps.localized/PUKFU POS.app" \
  "$HOME/Applications/Chrome Apps/PUKFU POS.app"
do
  if [ -d "$CANDIDATE" ]; then
    open "$CANDIDATE" && exit 0
  fi
done

# ยังไม่ได้ติดตั้ง ก็เปิดด้วยเบราว์เซอร์หลักของเครื่อง
# เข้าไปแล้วกด "ติดตั้งแอป" ท้ายหน้าตั้งค่าได้เลย ครั้งหน้าแอปนี้จะเปิดตัวที่ติดตั้งให้แทน
open "$URL" || {
  print -r -- "เปิดเบราว์เซอร์ไม่ได้

ลองเปิดที่อยู่นี้เองอีกที:
$URL" >&2
  exit 1
}
