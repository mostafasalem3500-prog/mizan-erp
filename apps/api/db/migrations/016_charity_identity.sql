-- Round 18: association identity taken from the supplied forms (only where not set yet)
UPDATE charity_settings SET association_name = 'جمعية ريادة العطاء لخدمة الإنسان بالعسيلة الأهلية', license_no = '1000888600', updated_at = now()
WHERE license_no IS NULL OR license_no = '';
