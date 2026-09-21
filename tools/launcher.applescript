-- "PUKFU-POS.app": ดับเบิลคลิกแล้วร้านเปิด ไม่ต้องไปหาที่คั่นหน้า
--
-- งานจริงอยู่ใน pos-open.sh ที่อยู่ในแอปด้วยกัน ตรงนี้มีหน้าที่เดียวคือรายงานตอนมีอะไรพัง
on run
	set openScript to quoted form of (POSIX path of (path to resource "pos-open.sh"))
	try
		do shell script openScript
	on error errorText
		display alert "เปิด PUKFU-POS ไม่ได้" message errorText as critical
	end try
end run
