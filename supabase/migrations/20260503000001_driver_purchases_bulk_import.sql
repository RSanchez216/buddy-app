-- Phase 2B: Driver Purchases bulk import from ClickUp v2 export
-- 103 driver_purchases + 119 unique drivers
-- Notes: Adilet Dzhenishpekov merged into Dzhenyshpekov (typo fix)
--        Kubanychbek Arzybai uulu/Uulu canonicalized to 'Uulu'
-- Generated 2026-05-03T01:39:38.753758 (v3: canonical-name propagation fix)

BEGIN;

-- =========================================================
-- STEP 1: drivers (119 unique)
-- =========================================================

INSERT INTO drivers (full_name, internal_id, notes) VALUES
  ('Econian Bezabeh', '651', 'Imported from ClickUp Phase 2B'),
  ('Ravshanbek Ergashbaev', '536', 'Imported from ClickUp Phase 2B'),
  ('Jean Justin F Badio', '567', 'Imported from ClickUp Phase 2B'),
  ('Mohammed Massom', '258', 'Imported from ClickUp Phase 2B'),
  ('Wafi Torialai', '223', 'Imported from ClickUp Phase 2B'),
  ('Yoel Oliveros Diaz', '502', 'Imported from ClickUp Phase 2B'),
  ('Leonard Karanja', '271', 'Imported from ClickUp Phase 2B'),
  ('Ahmad Farid', '542', 'Imported from ClickUp Phase 2B'),
  ('Hayat Hussaini', '341', 'Imported from ClickUp Phase 2B'),
  ('Casey Hashim Moe', '724', 'Imported from ClickUp Phase 2B'),
  ('Rebeca Sanchez', NULL, 'Imported from ClickUp Phase 2B'),
  ('Manas Kozhomkulov', '1177', 'Imported from ClickUp Phase 2B'),
  ('Bema', NULL, 'Imported from ClickUp Phase 2B'),
  ('Kubat Ryskeldiev', NULL, 'Imported from ClickUp Phase 2B'),
  ('Andy Neira Garcia', '229', 'Imported from ClickUp Phase 2B'),
  ('Tlek Ibraev', '1172', 'Imported from ClickUp Phase 2B'),
  ('Azamat Raimbek uulu', '1141', 'Imported from ClickUp Phase 2B'),
  ('Fazal Mohammad', '569', 'Imported from ClickUp Phase 2B'),
  ('Emir Kamchybekov', '1195', 'Imported from ClickUp Phase 2B'),
  ('Widler Pierre Jn - Trailer', '525', 'Imported from ClickUp Phase 2B'),
  ('Aibek Ibraimzhanov', '762', 'Imported from ClickUp Phase 2B'),
  ('Askat Dekenov', '701', 'Imported from ClickUp Phase 2B'),
  ('Muktarbek Onolbaev', '707', 'Imported from ClickUp Phase 2B'),
  ('Beksultan Mirzaev', '997', 'Imported from ClickUp Phase 2B'),
  ('Baatyrbek Tashbekov', '926', 'Imported from ClickUp Phase 2B'),
  ('Roody Guillaume', '350', 'Imported from ClickUp Phase 2B'),
  ('Damir Turgunaliev', '401', 'Imported from ClickUp Phase 2B'),
  ('Urmat Erkinbekov', '794', 'Imported from ClickUp Phase 2B'),
  ('Kenton Dorcely', '1220', 'Imported from ClickUp Phase 2B'),
  ('Pierre Dornelus', '1268', 'Imported from ClickUp Phase 2B'),
  ('Satybek Koilubaev', '295', 'Imported from ClickUp Phase 2B'),
  ('Odalien Odalus', '1269', 'Imported from ClickUp Phase 2B'),
  ('Urmatbek Almasbekov', '1387', 'Imported from ClickUp Phase 2B'),
  ('Pelissier Morilus', '1408', 'Imported from ClickUp Phase 2B'),
  ('Choubert Mera', '1356', 'Imported from ClickUp Phase 2B'),
  ('Bismillah Khan', '236', 'Imported from ClickUp Phase 2B'),
  ('Mackenson Sirius', '1483', 'Imported from ClickUp Phase 2B'),
  ('Adylbek Asylbekov', '1325', 'Imported from ClickUp Phase 2B'),
  ('Kantoro Asylbek uulu', '1396', 'Imported from ClickUp Phase 2B'),
  ('Rashid Bekturov', '1326', 'Imported from ClickUp Phase 2B'),
  ('Damian Rivera Hernandez', '109', 'Imported from ClickUp Phase 2B'),
  ('Nursultan Rysbekov', '547', 'Imported from ClickUp Phase 2B'),
  ('Marlen Samidinov', '962', 'Imported from ClickUp Phase 2B'),
  ('Ruslan Slabodnik', '1407', 'Imported from ClickUp Phase 2B'),
  ('Bakytbek Tolushev', '017', 'Imported from ClickUp Phase 2B'),
  ('Mykyta Orlov', '416', 'Imported from ClickUp Phase 2B'),
  ('RAM Pickup Truck - Aktilek', NULL, 'Imported from ClickUp Phase 2B'),
  ('Marc Kenson Etienne', '790', 'Imported from ClickUp Phase 2B'),
  ('Abdul Khaliq Tanha', '390', 'Imported from ClickUp Phase 2B'),
  ('Evens Mycout', '689', 'Imported from ClickUp Phase 2B'),
  ('Salamat Sharshenaliev', '473', 'Imported from ClickUp Phase 2B'),
  ('Milan''s', NULL, 'Imported from ClickUp Phase 2B'),
  ('Ruslan Urazbek uulu', '1868', 'Imported from ClickUp Phase 2B'),
  ('Raimbek Mananov', '1505', 'Imported from ClickUp Phase 2B'),
  ('Carl Henry Theard', '986', 'Imported from ClickUp Phase 2B'),
  ('Jean Hugens Louis', '349', 'Imported from ClickUp Phase 2B'),
  ('Kubanychbek Arzybai Uulu', '1909', 'Imported from ClickUp Phase 2B'),
  ('Mirlan Batyrkanov', NULL, 'Imported from ClickUp Phase 2B'),
  ('Abdikalim Berdikulov', NULL, 'Imported from ClickUp Phase 2B'),
  ('Taalaibek Aitemirov', NULL, 'Imported from ClickUp Phase 2B'),
  ('Maisal Atabaev', NULL, 'Imported from ClickUp Phase 2B'),
  ('Shekerbek Murzaliev', NULL, 'Imported from ClickUp Phase 2B'),
  ('Amanat Imanaliev', NULL, 'Imported from ClickUp Phase 2B'),
  ('Talgat Omurov', NULL, 'Imported from ClickUp Phase 2B'),
  ('Karl Marc Pinard', '630', 'Imported from ClickUp Phase 2B'),
  ('Zhusup Kenzhegul Uulu', '1182', 'Imported from ClickUp Phase 2B'),
  ('Eleman Mirbek Uulu', '1181', 'Imported from ClickUp Phase 2B'),
  ('Adylbek Shermatov', '1459', 'Imported from ClickUp Phase 2B'),
  ('Ulanychbek Shermatov', '1398', 'Imported from ClickUp Phase 2B'),
  ('Alymbek Satybaldiev', '1643', 'Imported from ClickUp Phase 2B'),
  ('Azamat Shakirov', '994', 'Imported from ClickUp Phase 2B'),
  ('Nurbek Nikeev', '1349', 'Imported from ClickUp Phase 2B'),
  ('Mairambek Mambetaliev', '247', 'Imported from ClickUp Phase 2B'),
  ('Dastanbek Razhapov', '1425', 'Imported from ClickUp Phase 2B'),
  ('Almaz Sydykov', NULL, 'Imported from ClickUp Phase 2B'),
  ('Daniel Tolkunbek uulu', NULL, 'Imported from ClickUp Phase 2B'),
  ('Ilyas Zhaxymuratov', NULL, 'Imported from ClickUp Phase 2B'),
  ('Ezekiel Hawthorne', NULL, 'Imported from ClickUp Phase 2B'),
  ('Anvarbek Nazaraliev', '1494', 'Imported from ClickUp Phase 2B'),
  ('Adilet Dzhenyshpekov', '1413', 'Imported from ClickUp Phase 2B'),
  ('Beksultan Nabiev', '1654', 'Imported from ClickUp Phase 2B'),
  ('Bolot Sagynbekov', '1869', 'Imported from ClickUp Phase 2B'),
  ('Argen Matkasymov', '1595', 'Imported from ClickUp Phase 2B'),
  ('Adyl Kadyraly uulu', NULL, 'Imported from ClickUp Phase 2B'),
  ('Beksultan Aigazy uulu', NULL, 'Imported from ClickUp Phase 2B'),
  ('Charlande Delva', '1575', 'Imported from ClickUp Phase 2B'),
  ('Mackenslor Delva', '1399', 'Imported from ClickUp Phase 2B'),
  ('Nurbek Kachybekov', '1392', 'Imported from ClickUp Phase 2B'),
  ('Maksatbek Kadyrkulov', '1380', 'Imported from ClickUp Phase 2B'),
  ('Malik Asanaliev', NULL, 'Imported from ClickUp Phase 2B'),
  ('Tilek Beishekadyrov', NULL, 'Imported from ClickUp Phase 2B'),
  ('Akylbek Alymbaev', '1462', 'Imported from ClickUp Phase 2B'),
  ('Zhantai Zhandraliev', '1412', 'Imported from ClickUp Phase 2B'),
  ('Islambek Kanybek uulu', '1608', 'Imported from ClickUp Phase 2B'),
  ('Zhoomart Toktoraliev', NULL, 'Imported from ClickUp Phase 2B'),
  ('Batageldi Chynarbekov', NULL, 'Imported from ClickUp Phase 2B'),
  ('Kairatbek Dyikanbaev', '1419', 'Imported from ClickUp Phase 2B'),
  ('Metjon Rustemi', '1482', 'Imported from ClickUp Phase 2B'),
  ('Shermukhamed Ermamatov', '1511', 'Imported from ClickUp Phase 2B'),
  ('Jean Charlotin', NULL, 'Imported from ClickUp Phase 2B'),
  ('Taalaibek Baabekov', '1397', 'Imported from ClickUp Phase 2B'),
  ('Charlie Hunt', NULL, 'Imported from ClickUp Phase 2B'),
  ('Yiman Ysaev', '1538', 'Imported from ClickUp Phase 2B'),
  ('Samuel Edoka', '1561', 'Imported from ClickUp Phase 2B'),
  ('Urmatbek Abdiev', '1740', 'Imported from ClickUp Phase 2B'),
  ('Abdullaev Shakhzodbek', NULL, 'Imported from ClickUp Phase 2B'),
  ('Navfarbek Madaminov', '1767', 'Imported from ClickUp Phase 2B'),
  ('Bakytbek Tairov', '1789', 'Imported from ClickUp Phase 2B'),
  ('Baiel Soltonov', '1831', 'Imported from ClickUp Phase 2B'),
  ('Almaz Osmonaliev', NULL, 'Imported from ClickUp Phase 2B'),
  ('Eshmukhamed Talaibekov', '1829', 'Imported from ClickUp Phase 2B'),
  ('Sergot Peralte', NULL, 'Imported from ClickUp Phase 2B'),
  ('Baktiiar Zhanybekov', '1818', 'Imported from ClickUp Phase 2B'),
  ('Jimmy Joselin', '1898', 'Imported from ClickUp Phase 2B'),
  ('Alex Aquino', '332', 'Imported from ClickUp Phase 2B'),
  ('Islam Bolotbaev', '1476', 'Imported from ClickUp Phase 2B'),
  ('Altynbek Emilev', '378', 'Imported from ClickUp Phase 2B'),
  ('Christopher Louidor', '1896', 'Imported from ClickUp Phase 2B'),
  ('Fidelson Joseph', '2047', 'Imported from ClickUp Phase 2B');

-- =========================================================
-- STEP 2: driver_purchases (103 records)
-- =========================================================

-- Record 271pphq: 651 - Econian Bezabeh - Unit 115
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Econian Bezabeh' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '115', NULL, NULL, NULL,
  70000, NULL, 0, 1500, 'weekly',
  '2021-12-02', 'KGZ Paid Full Debt

Purchase Price $61,300
Sold for $70,000', '271pphq'
);

-- Record 271ryuq: 536 - Ravshanbek Ergashbaev - Unit #44
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Ravshanbek Ergashbaev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '44', NULL, NULL, NULL,
  55000, NULL, 0, NULL, NULL,
  '2021-07-12', 'Driver Deposited $15,000 in a cashier check to 6589 on 07/13/21', '271ryuq'
);

-- Record 271tqtv: 567 - Jean Justin F Badio - Unit #33
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Jean Justin F Badio' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '33', NULL, NULL, NULL,
  60000, NULL, 0, NULL, NULL,
  '2021-07-30', 'Mailed to Harvey', '271tqtv'
);

-- Record 2aekhjb: 258 - Mohammed Massom - Trailer 201809
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Mohammed Massom' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '201809', NULL, NULL, NULL,
  60000, NULL, 0, 60000, NULL,
  '2022-05-02', 'Mailied to his house

His full paycheck will be used for trailer payment until further notice

He is asking if he can pay $4000 of his balance amount with his credit card.', '2aekhjb'
);

-- Record 271q2fu: 223 - Wafi Torialai - Unit 786
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Wafi Torialai' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '786', NULL, NULL, NULL,
  66000, NULL, 0, 1500, NULL,
  '2021-07-01', 'Wafi transferred to the dealer $60,000
Company transfer to the dealer $66,000
The title was never received at the company, the Driver must have it. Informed Tee about it on Telegram 04/11/22', '271q2fu'
);

-- Record 271tx54: 502 - Yoel Oliveros Diaz - Unit #49
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Yoel Oliveros Diaz' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Driver Left' LIMIT 1),
  'cash',
  '49', NULL, NULL, NULL,
  95000, NULL, 44000, 1500, NULL,
  '2021-07-15', 'Negative', '271tx54'
);

-- Record 2n4u1af: 271 - Leonard Karanja - Truck 54
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Leonard Karanja' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '54', NULL, NULL, NULL,
  95000, NULL, 0, 1500, NULL,
  NULL, NULL, '2n4u1af'
);

-- Record 2kc4jb9: 542 - Ahmad Farid - Trailer 201705 (VIN 841015)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Ahmad Farid' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '201705', '841015', NULL, NULL,
  54000, NULL, 0, 1500, NULL,
  '2022-04-11', 'Total Sale Price: $54,000
Driver gave $10,000  Downpayment
  Collected $44,000.00 from weekly payrolls.

Trailer #201705 purhased in cash by M-Team on 04/01/2022', '2kc4jb9'
);

-- Record 2gmmkqj: 341 - Hayat Hussaini / 848 - 2500 - VIN LM5448 Unit 5448
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Hayat Hussaini' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '5448', 'LM5448', NULL, NULL,
  95849.6, NULL, 0, 2000, NULL,
  '2022-03-04', ' weekly $5000 for 7 weeks to make $35K   After that we will pay $2000 (Per Mr. Tee) From W41 charging 848 - Sharif Hussaini

Premier Truck

Sending wire payment on 03/04/22
See confirmation', '2gmmkqj'
);

-- Record 24q9kux: 724 - Casey Hashim Moe - Unit 645
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Casey Hashim Moe' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '645', NULL, NULL, NULL,
  70000, NULL, 0, 1500, NULL,
  '2022-02-07', '$2500 per driver from W01

Texted Tee regarding Missing Title for truck on 03/24/22

Driver is going on Vacation from 06/01/22. Once he returns need to charge him $3000 for 5 weeks then go back to $1500 weekly.', '24q9kux'
);

-- Record 29qgjmq: Rebeca Sanchez - Unit 2121
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Rebeca Sanchez' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  '2121', NULL, NULL, NULL,
  57500, NULL, 44988.98, 1224.59, 'monthly',
  NULL, 'October done on 10/13 - 1120 - Abdullah Omari', '29qgjmq'
);

-- Record 8677w63hy: 1177 - Manas Kozhomkulov - Truck 07M
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Manas Kozhomkulov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Owner Left' LIMIT 1),
  'cash',
  '07M', NULL, NULL, NULL,
  101259.34, NULL, 95000, 1000, NULL,
  '2023-03-08', 'Quit

VIN - 1XKYDP9X7MJ453522', '8677w63hy'
);

-- Record 2waq2vz: Bema - Unit 912
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Bema' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Owner Left' LIMIT 1),
  'cash',
  '912', NULL, NULL, NULL,
  111721.8, NULL, 104273.68, 1862.03, NULL,
  '2022-08-26', 'February done on 3/9

The purchase of this unit is under a loan by Ascentium Capital.

The charges to Bema will be done monthly.
Requested Loan amount to the bank. I will update once received.

Sent lease agreement, waiting on signature

Need to charge $1,143.29 for Truck Registration 2022-2023 | Unit 912
Need to charge $80 for Truck Registration Service Fee.
Need to charge $308.98 for 1106 - Bilal Zaheer''s Flight Ticket - 09/02/22.
Need to charge $985.00 for Towing - 09/06/22.
Need to charge $9.96 for Uber Ride on 09/06/22.
Need to charge $343.37 for Hotel on 09/09/22.
Applied above charges to W43 Payroll.

Need to charge following from TengriL LLC
$1,759.00 for Week 09 Negative Balance
$1,500.00 for Truck Registration 2023-2024 | Unit# 912
$3,546.99 for Shop Invoice - 3/23/23 | Unit# 912', '2waq2vz'
);

-- Record 24hm6uj: Kubat Ryskeldiev
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Kubat Ryskeldiev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Pending Start' LIMIT 1),
  'cash',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 0, NULL, NULL,
  NULL, 'Waiting on the payments to be posted to let Tee know how much Kubat needs to pay.', '24hm6uj'
);

-- Record 85ztm9p6q: 229 - Andy Neira Garcia - Truck 52
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Andy Neira Garcia' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Contract Broken' LIMIT 1),
  'cash',
  '52', NULL, NULL, NULL,
  45000, NULL, 43270, 865, NULL,
  '2023-07-18', NULL, '85ztm9p6q'
);

-- Record 8677hr3hd: 1172 - Tlek Ibraev - Truck 51
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Tlek Ibraev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Owner Left' LIMIT 1),
  'cash',
  '51', NULL, NULL, NULL,
  74000, NULL, 69500, 1500, NULL,
  '2023-02-10', 'Terminated', '8677hr3hd'
);

-- Record 864e68nea: 1141 - Azamat Raimbek uulu
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Azamat Raimbek uulu' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Driver Left' LIMIT 1),
  'cash',
  NULL, NULL, NULL, NULL,
  82860, NULL, 64360, 1000, NULL,
  NULL, '$1000 per Tee

On 12/06/22 From account 6589 we purchased the truck for Azamat for $60K

On 01/19/23 on account 6589 we received the $60K Back after the truck was put on a loan.', '864e68nea'
);

-- Record 2wata6b: 569 - Fazal Mohammad - Truck 1D
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Fazal Mohammad' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '1D', NULL, NULL, NULL,
  42449.52, NULL, 0, 1000, NULL,
  '2022-07-19', NULL, '2wata6b'
);

-- Record 85zt44mfm: 1195 - Emir Kamchybekov (truck #887)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Emir Kamchybekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Owner Left' LIMIT 1),
  'cash',
  '887', NULL, NULL, NULL,
  127817, NULL, 120927, 530, NULL,
  '2023-04-27', 'starting from week 21

2021 Kenworth Construction T680
unit #887
VIN #1XKYD49X1MJ457869
Purchase of M Team Investment from Falcon National Bank on 04/19/2023

Total $127 817
Charge the driver $530 weekly.', '85zt44mfm'
);

-- Record 2cyggua: 525 - Widler Pierre Jn - Trailer
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Widler Pierre Jn - Trailer' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  NULL, NULL, NULL, NULL,
  12000, NULL, 0, 1500, NULL,
  '2022-05-20', NULL, '2cyggua'
);

-- Record 2v2pj5d: 762 - Aibek Ibraimzhanov - Truck 98
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Aibek Ibraimzhanov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '98', NULL, NULL, NULL,
  30000, NULL, 0, 2500, NULL,
  '2022-08-15', 'Purchase from Manas Bank of America 8458 on 08/15/22
Truck Price $30,000
Wire fee $30 charged on payroll W34 - 09/01/22

Charge the driver $2500 Weekly

The lease agreement was sent to Aibek in his email on 08/19/22, and we await his answer.

Also waiting on the title. Already in Harvey

The driver signed the lease agreement on 08/21/22 and received the original title in AH Office. 👍', '2v2pj5d'
);

-- Record 271unkd: 701 - Askat Dekenov / 707 - Muktarbek Onolbaev - Unit# 007
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Askat Dekenov' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Muktarbek Onolbaev' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '007', NULL, NULL, NULL,
  60000, NULL, 0, 1000, NULL,
  '2021-09-20', '$60,000.00 collected from Weekly Payrolls.', '271unkd'
);

-- Record 2warrtu: 997 - Beksultan Mirzaev - Truck 789
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Beksultan Mirzaev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '789', NULL, NULL, NULL,
  45000, NULL, 0, 1500, NULL,
  '2022-07-28', 'Quit

The driver has the title and will bring it to the office

Email him the lease agreement. Waiting on it.', '2warrtu'
);

-- Record 2ck1xmk: 926 - Baatyrbek Tashbekov - Truck 8415
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Baatyrbek Tashbekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '8415', NULL, NULL, NULL,
  75000, NULL, 0, 1000, NULL,
  '2022-05-02', '$1000 per Zack

Sale Price $75,000

Need to charge the driver a $5,000 Downpayment as soon as the driver has money.
The rest of the payments are $2,000 weekly', '2ck1xmk'
);

-- Record 24hjj6d: 350 - Roody Guillaume - Unit# 9475
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Roody Guillaume' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '9475', NULL, NULL, NULL,
  90000, NULL, 0, 2000, NULL,
  '2022-03-14', '$2000 per Tee. Negative', '24hjj6d'
);

-- Record 863g6vkgq: 525 - Widler Pierre Jn - Trailer (Transfer 08/18/22)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Widler Pierre Jn - Trailer' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  NULL, NULL, NULL, NULL,
  12030, NULL, 0, 500, NULL,
  '2022-08-18', 'Charge More when possible

The driver purchased this trailer back in August then, he went off due to his father being sick. And we never charge him

Additional info: Transfer 08/18/22', '863g6vkgq'
);

-- Record 2x1hmh9: 401 - Damir Turgunaliev - Truck 1808
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Damir Turgunaliev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '1808', NULL, NULL, NULL,
  57000, NULL, 0, 1500, NULL,
  '2022-08-22', '$1000 per Tee

Emailed him the lease agreement on 09/02/22 Waiting on him to sign
Received signed the lease agreement on 09/08/22


Waiting on Title', '2x1hmh9'
);

-- Record 24hkh7t: 794 - Urmat Erkinbekov - Unit# TNC7257
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Urmat Erkinbekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  'TNC7257', NULL, NULL, NULL,
  248200, NULL, 105000, 1000, NULL,
  '2022-03-11', '$1000 weekly per Tee

VIN NSNC7257

The total Purchase price is $248,200

11 Times $4000
52 Times $2600
The Pending Buyout Fee of $48,000 will be deducted from Manas and Pending to Charge Urmat.', '24hkh7t'
);

-- Record 85ztxw83e: 1220-Kenton Dorcely - 1268-Pierre Dornelus - Truck #19
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Kenton Dorcely' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Pierre Dornelus' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '19', NULL, NULL, NULL,
  23000, NULL, 0, 1000, NULL,
  '2023-09-05', 'Once the truck has driver assigned the charges will start

Sale Price $23,000

Downpayment: $2300 received by Zelle', '85ztxw83e'
);
-- Record 26w5a3p: 295 - Satybek Koilubaev - Unit TNC0254
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Satybek Koilubaev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  'TNC0254', NULL, NULL, NULL,
  210000, NULL, 0, 2000, NULL,
  '2021-12-01', 'Received Zelle Transfers:
$3,500 on 03/17/23
$3,500 on 03/18/23
$1,000 on 03/19/23
$3,500 on 06/19/23
$500 on 10/23/23
$1,000 on 11/06/23', '26w5a3p'
);

-- Record 86dqtrx09: 1269 - Odalien Odalus - Unit #40
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Odalien Odalus' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '40', NULL, NULL, NULL,
  30000, NULL, 0, 1000, NULL,
  '2023-12-03', 'Driver Purchase Truck 40 for $30,000 giving a downpayment of $3000 paid by credit card', '86dqtrx09'
);

-- Record 86drwdy8b: 1387 - Urmatbek Almasbekov - Truck 905
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Urmatbek Almasbekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '905', NULL, NULL, NULL,
  14000, NULL, 0, 1000, NULL,
  '2024-02-20', 'Manas paid for the debt of his truck, for a total of $14,000', '86drwdy8b'
);

-- Record 86drcj2nj: 1408 - Pelissier Morilus | 1220 - Kenton Dorcely / 1356 - Choubert Mera | 236 -B
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Pelissier Morilus' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Kenton Dorcely' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Choubert Mera' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Bismillah Khan' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '201701', NULL, NULL, NULL,
  22500, NULL, 4100, 400, 'weekly',
  '2024-01-18', 'Purchase Price: $25,000
Downpayment: $2500 by Zelle
Remaining: $22,500 will be on payments of $400 weekly', '86drcj2nj'
);

-- Record 86du3wc5b: 1483 - Mackenson Sirius - Truck# T781130
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Mackenson Sirius' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  'T781130', NULL, NULL, NULL,
  85000, NULL, 36000, 1000, 'weekly',
  '2024-07-09', 'Total Value: $85,000.00
Down Payment: $8,000.00', '86du3wc5b'
);

-- Record 86dugj3b6: 1325 - Adylbek Asylbekov (Cash Advance)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Adylbek Asylbekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  NULL, NULL, NULL, NULL,
  16000, NULL, 0, 2666.66, NULL,
  '2024-08-28', 'Manas Express is borrowing $16,000 to Adylbek to purchase 3 trucks
Adylbek must pay back in 6 weeks, for a weekly payment of $2666.66
+$25 Transfer Fee - Charged on Week 34
Charge from one check only, do not divide per truck.

Additional info: Cash Advance', '86dugj3b6'
);

-- Record 86dtc5uga: 1396 - Kantoro Asylbek uulu - Truck #455
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Kantoro Asylbek uulu' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '455', NULL, NULL, NULL,
  91600, NULL, 0, 2500, NULL,
  '2024-04-25', 'Per Zack $2500 for 2 months then $4000

Total Value = $91,600.00
Downpayment = $35,000.00', '86dtc5uga'
);

-- Record 86dqtrkx5: 1326 - Rashid Bekturov - Unit #57
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Rashid Bekturov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '57', NULL, NULL, NULL,
  110000, NULL, 0, 1000, NULL,
  '2023-12-01', 'Driver purchased truck 57 for $110,000
With a downpayment of $20,000 by cashier check deposited on M-Team account on 12/04/23', '86dqtrkx5'
);

-- Record 8677hqnhg: 109 - Damian Rivera Hernandez - Truck 50
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Damian Rivera Hernandez' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '50', NULL, NULL, NULL,
  85000, NULL, 3000, 1000, 'weekly',
  '2023-02-01', 'Truck is down as of 08/13

His payment history will start from the moment he took the truck and start making the payment of $1500 back on W50 - 12/22/22', '8677hqnhg'
);

-- Record 2kqgb92: 547 - Nursultan Rysbekov - Unit# 74 (TNC0180)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Nursultan Rysbekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '74', NULL, NULL, NULL,
  153000, NULL, 0, 1000, NULL,
  '2023-01-16', '$1000 weekly

501 - Nuraly Murzakasymov - Unit TNC0180 = PREVIOUS OWNER

Balance from Salvage Truck: $8,260
Paid off on 04/18/22

Downpayment: $30,000
Registrations Fees 2021: $1469.42
Subtotal: $31,469.42
4 Months of missing truck payment: $14,400
Subtotal: $45,869.42
To be charge on:

Nuraly will directly transfer to Manas Account

2022 FREIGHTLINER CASCADIA
           Vin: 1FUJHHDR9NLNC0180
           Value $159,000.00

Monthly payments of $3600 will be applied weekly. $900 Weekly

Additional info: TNC0180', '2kqgb92'
);

-- Record 2mcv9xu: 962 - Marlen Samidinov / 1407 - Ruslan Slabodnik - Unit #71
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Marlen Samidinov' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Ruslan Slabodnik' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '71', NULL, NULL, NULL,
  155022.76, NULL, 76750, 750, 'weekly',
  '2022-02-02', 'Contract Driver Quit

Purchase Price $240,000.00

Manas Paid $175,082.76
Wire Fee $40
Driver Deposited to Manas $20,080

Remaining Balance: $155,022.76
He will also have a shop invoice to pay (attached below) - Applied the charge on week 42 payroll.', '2mcv9xu'
);

-- Record 2rw0wyd: 017 - Bakytbek Tolushev - Unit 34
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Bakytbek Tolushev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '34', NULL, NULL, NULL,
  NULL, NULL, 0, NULL, NULL,
  NULL, 'Fully paid by the driver, need to pay to the bank.', '2rw0wyd'
);

-- Record 2rw40b4: 416 - Mykyta Orlov - Unit #600
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Mykyta Orlov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Waiting Sign Contract' LIMIT 1),
  'cash',
  '600', NULL, NULL, NULL,
  96500, NULL, 0, 2500, NULL,
  '2021-12-29', 'Collected from Weekly Payrolls: $77,500.00', '2rw40b4'
);

-- Record 85ztcpxd2: RAM Pickup Truck - Aktilek
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'RAM Pickup Truck - Aktilek' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  NULL, NULL, NULL, NULL,
  45000, NULL, 7000, 3500, 'monthly',
  '2023-04-14', 'Rebeca Updates

Sold fro $45,000
Transfer in KG: $10,000

Remaining Balance of $35,000
Will be automatically ACH $3500 monthly every 5th.', '85ztcpxd2'
);

-- Record 2aekabd: 790 - Marc Kenson Etienne - Truck 53
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Marc Kenson Etienne' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '53', NULL, NULL, NULL,
  95000, NULL, 0, 1000, NULL,
  '2022-05-03', 'Total Price $130,000
Downpayment of $35,000
Wire Transfer of $40,000.00 on 4/17/2023.
Collected $55,000.00 from weekly payrolls.', '2aekabd'
);

-- Record 2ck1kxt: 390 - Abdul Khaliq Tanha - Trailer 201802
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Abdul Khaliq Tanha' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Waiting Sign Contract' LIMIT 1),
  'cash',
  '201802', NULL, NULL, NULL,
  60000, NULL, 0, NULL, NULL,
  '2022-04-01', 'The total price of the trailer is $60K

The driver supposes to wire $20K to the company, but so far he hasn''t.

Per Tee, charge as much as possible and leave the driver with $1000 only.

Collected $60,000.00 from weekly payrolls.', '2ck1kxt'
);

-- Record 2rw2kvh: 689 - Evens Mycout - Unit #47
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Evens Mycout' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Waiting Sign Contract' LIMIT 1),
  'cash',
  '47', NULL, NULL, NULL,
  33000, NULL, 0, 1500, NULL,
  '2021-11-29', 'Driver give $10,000 Cash ad Downpayment

Collected $33,000.00 from weekly payrolls.', '2rw2kvh'
);

-- Record 271tupn: 473 - Salamat Sharshenaliev - Unit #45
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Salamat Sharshenaliev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Waiting Sign Contract' LIMIT 1),
  'cash',
  '45', NULL, NULL, NULL,
  68000, NULL, 0, 1500, NULL,
  '2021-07-29', 'Driver deposited $12,000 for downpayment.', '271tupn'
);

-- Record 29qgktq: Milan's - Unit 04
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Milan''s' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  '04', NULL, NULL, NULL,
  39799.6, NULL, 29094.55, 760.8, 'monthly',
  NULL, 'October done on 10/13 - 804 - Myrzakmat Ukubaev

Milan Transferred $21,500.00 via Zelle.
Collected: $9,890.40 from Statements (822 - Murat B Basymbekov, 804 - Myrzakmat Ukubaev, 823 - Ruslan Tiumenbaev)
On week 47 (2022) Milan has a negative Statement of $7,536.86 (804 - Myrzakmat Ukubaev)', '29qgktq'
);

-- Record 86dy69kg4: 1868 - Ruslan Urazbek uulu - Truck R555
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Ruslan Urazbek uulu' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  'R555', NULL, NULL, NULL,
  8000, NULL, 0, 1000, NULL,
  '2025-10-17', NULL, '86dy69kg4'
);

-- Record 86du3we4e: 1505 - Raimbek Mananov - Truck# 827 (847)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Raimbek Mananov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '827', NULL, NULL, NULL,
  20000, NULL, 0, 1000, NULL,
  '2024-07-08', '$2K x 4 Weeks then $1K weekly

Total Value: $20,000.00
Truck is in the yard per Luke (05/27/25)
Per Zhanyl, driver will be coming back to work. (07/01/25)

Additional info: 847', '86du3we4e'
);

-- Record 85zu0ggrv: 986 - Carl Henry Theard - Truck #52
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Carl Henry Theard' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '52', NULL, NULL, NULL,
  40500, NULL, 0, 500, NULL,
  '2023-09-07', 'Truck Price $45,000
Downpayment of $4500 paid by credit card', '85zu0ggrv'
);

-- Record 86dv6dkqg: 349 - Jean Hugens Louis - Truck 51
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Jean Hugens Louis' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '51', NULL, NULL, NULL,
  40000, NULL, 0, 1000, NULL,
  '2024-11-13', '$1000 Weekly

Total Value: $40,000.00
Down Payment: $4,000.00 ($1,400 Zelle + Wk 46 and Wk 47 Payrolls)', '86dv6dkqg'
);

-- Record 86dy3xd7n: Kubanychbek Arzybai Uulu - Truck 89 (VIN# 3AKJHHDR1LSLU0908)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Kubanychbek Arzybai Uulu' LIMIT 1),
  ARRAY[]::uuid[],
  (SELECT id FROM loan_entities WHERE name ILIKE '%baikozu%' LIMIT 1),
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Contract Broken' LIMIT 1),
  'cash',
  '89', '3AKJHHDR1LSLU0908', NULL, NULL,
  68000, NULL, 39000, 2115, NULL,
  NULL, 'Total Loss due to Accident

Total Value: $68,000.00
Balance to the bank: $44,238.00', '86dy3xd7n'
);

-- Record 86dy40kpm: Mirlan Batyrkanov - Truck 66 (VIN# 3AKJHHDR3NSNB8977)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Mirlan Batyrkanov' LIMIT 1),
  ARRAY[]::uuid[],
  (SELECT id FROM loan_entities WHERE name ILIKE '%baikozu%' LIMIT 1),
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  '66', '3AKJHHDR3NSNB8977', NULL, NULL,
  85000, NULL, 54381, 2554, 'monthly',
  NULL, 'Total Value: $85,000.00
Balance to the bank: $70,701.00', '86dy40kpm'
);

-- Record 86dy40mff: Abdikalim Berdikulov - Truck 55 (VIN# 1FUJHHDR3NLMZ0517)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Abdikalim Berdikulov' LIMIT 1),
  ARRAY[]::uuid[],
  (SELECT id FROM loan_entities WHERE name ILIKE '%baikozu%' LIMIT 1),
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  '55', '1FUJHHDR3NLMZ0517', NULL, NULL,
  101500, NULL, 0, 2604, 'monthly',
  NULL, 'Total Value: $101,500.00
Balance to the bank: $76,031.00', '86dy40mff'
);

-- Record 86dy40nmd: Taalaibek Aitemirov - Truck 88 (VIN# 3AKJHHDR5PSND8019)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Taalaibek Aitemirov' LIMIT 1),
  ARRAY[]::uuid[],
  (SELECT id FROM loan_entities WHERE name ILIKE '%baikozu%' LIMIT 1),
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  '88', '3AKJHHDR5PSND8019', NULL, NULL,
  120900, NULL, 4495, 3128, 'monthly',
  NULL, 'Total Value: $120,900.00
Balance to the bank: $95,427.00', '86dy40nmd'
);

-- Record 86dy40qyg: Maisal Atabaev - Truck 6 (N/A)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Maisal Atabaev' LIMIT 1),
  ARRAY[]::uuid[],
  (SELECT id FROM loan_entities WHERE name ILIKE '%baikozu%' LIMIT 1),
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  '6', NULL, NULL, NULL,
  96915, NULL, 96915, 2597, 'monthly',
  NULL, 'Total Value: $96,915.00
Balance to the bank: $38,000.00

Additional info: N/A', '86dy40qyg'
);

-- Record 86dy40t1z: Shekerbek Murzaliev - Truck 77 (VIN# 4V4NC9EH6KN195452)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Shekerbek Murzaliev' LIMIT 1),
  ARRAY[]::uuid[],
  (SELECT id FROM loan_entities WHERE name ILIKE '%baikozu%' LIMIT 1),
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  '77', '4V4NC9EH6KN195452', NULL, NULL,
  45355, NULL, 26500, NULL, 'monthly',
  NULL, 'Total Value: $45,355.00
Balance to the bank: $31,379.00', '86dy40t1z'
);

-- Record 86dy40t2y: Amanat Imanaliev
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Amanat Imanaliev' LIMIT 1),
  ARRAY[]::uuid[],
  (SELECT id FROM loan_entities WHERE name ILIKE '%baikozu%' LIMIT 1),
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 0, NULL, 'monthly',
  NULL, NULL, '86dy40t2y'
);

-- Record 86dy40t5c: Talgat Omurov
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Talgat Omurov' LIMIT 1),
  ARRAY[]::uuid[],
  (SELECT id FROM loan_entities WHERE name ILIKE '%baikozu%' LIMIT 1),
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 0, NULL, 'monthly',
  NULL, NULL, '86dy40t5c'
);

-- Record 86dy40tgt: Kubanychbek Arzybai uulu - Trailer #1
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Kubanychbek Arzybai Uulu' LIMIT 1),
  ARRAY[]::uuid[],
  (SELECT id FROM loan_entities WHERE name ILIKE '%baikozu%' LIMIT 1),
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  '1', NULL, NULL, NULL,
  NULL, NULL, 56700, NULL, 'monthly',
  NULL, NULL, '86dy40tgt'
);

-- Record 86dy40thu: Maisal Atabaev
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Maisal Atabaev' LIMIT 1),
  ARRAY[]::uuid[],
  (SELECT id FROM loan_entities WHERE name ILIKE '%baikozu%' LIMIT 1),
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Monthly Payment' LIMIT 1),
  'cash',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 0, NULL, 'monthly',
  NULL, NULL, '86dy40thu'
);

-- Record 23n1heq: 630 - Karl Marc Pinard (Truck 69) - VIN 364342 - BMO M-TEAM Loan 9350872-001
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Karl Marc Pinard' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'driver_bank_loan',
  '69', '364342', NULL, NULL,
  120000, NULL, 2500, 1500, 'weekly',
  '2022-02-18', '$1000 weekly per Mr. Tee.

UNIT #69

$20,000 Downpayment

Additional info: BMO M-TEAM Loan 9350872-001', '23n1heq'
);

-- Record 85zryfdp7: #1182 - Zhusup Kenzhegul Uulu - truck 101
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Zhusup Kenzhegul Uulu' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '101', NULL, NULL, NULL,
  108687.36, NULL, 0, 1000, NULL,
  '2023-04-18', '2020 Volvo Tractor 4V4NC9TJ5LN255101
Purchase of M Team Investment from First Business Bank on 04/18/2023
Total $108,687.36
One-time fee for overnight  shipping $48

Charge the driver $1000 Weekly', '85zryfdp7'
);

-- Record 86dugj4th: 926 - Baatyrbek Tashbekov (Collect at front)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Baatyrbek Tashbekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  NULL, NULL, NULL, NULL,
  15000, NULL, 0, NULL, NULL,
  '2024-08-28', 'Once collected, pay for his truck to Semetei Asilbek Uulu

Additional info: Collect at front', '86dugj4th'
);

-- Record 860ry1wc2: 1181 - Eleman Mirbek Uulu - Truck 887
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Eleman Mirbek Uulu' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '887', NULL, NULL, NULL,
  120500, NULL, 0, 1000, NULL,
  '2023-10-07', 'The driver purchased the truck on 10/07/23 for $120,500
For the first 8 weeks, the driver will pay $2000
After that, he will pay $730 Weekly', '860ry1wc2'
);

-- Record 86dt8j890: 1459 - Adylbek Shermatov/1398 - Ulanychbek Shermatov /1643 - Alymbek Satybaldiev
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Adylbek Shermatov' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Ulanychbek Shermatov' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Alymbek Satybaldiev' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '03', NULL, NULL, NULL,
  46412.16, NULL, 0, 1000, NULL,
  '2024-04-08', 'Total Value = $61,412.16
Downpayment = $15,000.00 Cash', '86dt8j890'
);

-- Record 3eq14z5: 994 - Azamat Shakirov - Truck 1582
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Azamat Shakirov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '1582', NULL, NULL, NULL,
  94500, NULL, 10000, 1000, NULL,
  NULL, 'Received $10K on 08/26/25', '3eq14z5'
);
-- Record 8677w5u3w: 1349 - Nurbek Nikeev - Truck 119 (247 - Mairambek Mambetaliev)
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Nurbek Nikeev' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Mairambek Mambetaliev' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '119', NULL, NULL, NULL,
  101259.34, NULL, 0, 1000, NULL,
  '2023-03-08', 'Downpayment of $9,207.74 was done fpr both trucks,
Week #09 -$4000 Payroll deduction
Week #10 -$4000 Payroll deduction
Week #14 -$1207.74 Payroll deduction', '8677w5u3w'
);

-- Record 86du308f4: 1425 - Dastanbek Razhapov / 1325 - Adylbek Asylbekov / Almaz Sydykov / Daniel To
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Dastanbek Razhapov' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Adylbek Asylbekov' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Almaz Sydykov' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Daniel Tolkunbek uulu' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Ilyas Zhaxymuratov' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Ezekiel Hawthorne' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '59', NULL, NULL, NULL,
  57500, NULL, 0, 1000, NULL,
  '2024-07-01', 'Total Value: $57,500.00', '86du308f4'
);

-- Record 86dvqazg2: 1494 - Anvarbek Nazaraliev - Truck 987
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Anvarbek Nazaraliev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '987', NULL, NULL, NULL,
  43000, NULL, 0, 1000, NULL,
  '2025-01-15', '$1000 weekly

Total Value: $43,000.00
Down Payment: $5,000.00 (Via Zelle)', '86dvqazg2'
);

-- Record 86dw7yeqd: 1413 - Adilet Dzhenyshpekov - Truck TNC0254
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Adilet Dzhenyshpekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  'TNC0254', NULL, NULL, NULL,
  70000, NULL, 4900, 1000, NULL,
  '2025-02-25', 'Total Value: $70,000.00
Down Payment: $4,500.00 (Collected from statements) + $5,500.00 Adilet will give in Bishkek KG Office.


Bought it back from Satybek for 60K in Real Estate in Bishkek.', '86dw7yeqd'
);

-- Record 86dxcngv4: 1654 - Beksultan Nabiev - Truck 296625
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Beksultan Nabiev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '296625', NULL, NULL, NULL,
  62500, NULL, 0, 1000, NULL,
  '2025-06-24', '$1000 weekly

Total Value: $62,500.00
Down Payment: $6,000.00 on Week 24 and 25 Payrolls.', '86dxcngv4'
);

-- Record 86dy69jwn: 1869 - Bolot Sagynbekov - Truck 083
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Bolot Sagynbekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '083', NULL, NULL, NULL,
  5000, NULL, 4000, 1000, NULL,
  '2025-10-06', NULL, '86dy69jwn'
);

-- Record 8677w5uuk: Mairambek Mambetaliev - Truck 119  | 1595 - Argen Matkasymov - Truck 119  / Adyl
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Mairambek Mambetaliev' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Argen Matkasymov' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Adyl Kadyraly uulu' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Beksultan Aigazy uulu' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '119', NULL, NULL, NULL,
  101259.34, NULL, 38700, 700, 'weekly',
  '2023-03-08', NULL, '8677w5uuk'
);

-- Record 86dugp9a2:  1575 - Charlande Delva | 1399 - Mackenslor Delva | 1269 - Odalien Odalus - Truc
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Charlande Delva' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Mackenslor Delva' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Odalien Odalus' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '912', NULL, NULL, NULL,
  50000, NULL, 0, 1000, 'weekly',
  '2024-08-01', 'Total Value: $50,000.00
Down Payrment: $5,000.00
Previously 1269 - Odalien Odalus was purchasing it, as of week 42 1399 - Mackenslor Delva has purchased it and continues paying for it.', '86dugp9a2'
);

-- Record 86dttunrh: 1392 - Nurbek Kachybekov - Truck# 88
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Nurbek Kachybekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '88', NULL, NULL, NULL,
  74314, NULL, 18300, 700, 'weekly',
  '2024-05-31', '$700 weekly

Total Value: $84,314
Down Payment: $10,000.00 = 2 Zelle Transfers to TMS 5631
1- $9000 on 05/14/24
2- $1000 on 06/13/24
-------------------------------', '86dttunrh'
);

-- Record 86drucqh6: 1380 - Maksatbek Kadyrkulov > Malik Asanaliev  | Tilek Beishekadyrov - Unit# 84
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Maksatbek Kadyrkulov' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Malik Asanaliev' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Tilek Beishekadyrov' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '84', NULL, NULL, NULL,
  87757, NULL, 37300, 800, 'weekly',
  '2024-02-20', 'Weekly $800

Original Purchaser: 1380 - Maksatbek Kadyrkulov
Driver purchased a truck on 02/20/2024 for $97,367
Deposited $20,000.00 for downpayment into Manas Bank of America Account
TMS made a downpayment to the Bank for $9,610.00

Left money for the downpayment needs to go back to the driver. -$45 for wire fees. Is $10,345
This money will be used by the driver for something else. Need to confirm with Zack', '86drucqh6'
);

-- Record 86dt3xx04: 1462 - Akylbek Alymbaev - 1413 - Adilet Dzhenyshpekov - Truck# 66
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Akylbek Alymbaev' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Adilet Dzhenyshpekov' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '66', NULL, NULL, NULL,
  110000, NULL, 28800, 1000, 'weekly',
  '2024-03-25', 'Total Value = $120,000.00
Downpayment = $10,000.00', '86dt3xx04'
);

-- Record 86dt3y357: 1412 - Zhantai Zhandraliev - Truck# 64
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Zhantai Zhandraliev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '64', NULL, NULL, NULL,
  120000, NULL, 41000, 1000, 'weekly',
  '2024-03-27', 'Total Value = $130,000.00
Downpayment = $10,000.00', '86dt3y357'
);

-- Record 86dtm1144: 1413 - Adilet Dzhenishpekov / 1608-Islambek Kanybek uulu / Zhoomart Toktoraliev
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Adilet Dzhenyshpekov' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Islambek Kanybek uulu' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Zhoomart Toktoraliev' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Batageldi Chynarbekov' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '61', NULL, NULL, NULL,
  120000, NULL, 33000, 1000, 'weekly',
  '2024-05-20', 'Total: $120,000.00
Down Payment: $3,000.00 on 05/20/24
Cash Payment: $2000 on 05/21/24
Zelle Payment: $2000 on 05/31/24
Zelle Payment: $3000 on 05/31/24
Total Downpayment Received: $10,000', '86dtm1144'
);

-- Record 86dt3y6bj: 1419 - Kairatbek Dyikanbaev - Truck# 67
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Kairatbek Dyikanbaev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '67', NULL, NULL, NULL,
  103000, NULL, 19000, 1000, 'weekly',
  '2024-03-28', 'Total Value = $120,000.00
Downpayment = $12,000.00 Cash - Deposited into 0617 on 04/16/24



New purchase price is $115,000.00  Tee gave a discount. (04/05/24) See new contract attached.', '86dt3y6bj'
);

-- Record 86dttbqhd: 1482 - Metjon Rustemi - Truck# 72
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Metjon Rustemi' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '72', NULL, NULL, NULL,
  115000, NULL, 21000, 800, 'weekly',
  NULL, 'Total Value: $115,000.00
Down payment: $11,500.00
Zelle on 05/30/24 - $500 (From Hidayat)
Zelle on 06/03/24 - $1,000 (From Metjon)
Zelle on 06/04/24 - $1,000 (From Metjon)
Zelle on 06/05/24 - $1,000 (From Metjon)
Zelle on 06/06/24 - $1,000 (From Metjon)
Zelle on 06/07/24 - $1,000 (From Metjon)
Zelle on 06/10/24 - $2,000 (From Metjon)
Zelle on 06/11/24 - $2,000 (From Metjon)
Zelle on 06/12/24 - $2,000 (From Metjon)', '86dttbqhd'
);

-- Record 86du2zejp: 1511 - Shermukhamed Ermamatov / Alymbek Satybaldiev - Truck# 68
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Shermukhamed Ermamatov' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Alymbek Satybaldiev' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '68', NULL, NULL, NULL,
  110000, NULL, 42000, 1000, 'weekly',
  '2024-07-02', 'Total Value: $110,000.00
Down Payment: $15,000.00', '86du2zejp'
);

-- Record 86dujhrzy: 1408 - Pelissier Morilus - Truck 120
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Pelissier Morilus' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  '120', NULL, NULL, NULL,
  67000, NULL, 0, 1000, NULL,
  '2024-05-30', '$1000 Weekly

Total Value: $67,000.00
Down Payment: $6,700.00
1408 - Pelissier Morilus has purchased it as of 10/14/24 for $54,000.00
Previously Kenton Dorcely was purchasing it.
On 05/09/25 Pelissier said that he will come and pay off the balance on Monday 05/12/25 and wants to receive title.', '86dujhrzy'
);

-- Record 86dugpduz: 1356 - Choubert Mera / Jean Charlotin - Truck 115
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Choubert Mera' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Jean Charlotin' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '115', NULL, NULL, NULL,
  70000, NULL, 24000, 1000, 'weekly',
  '2024-08-16', 'Total Value: $70,000.00
Down Payment: $7,000.00

Driver is ready to purchase in full, but we don''t have the title yet.
Working on it.', '86dugpduz'
);

-- Record 86dv577vy: 1397 - Taalaibek Baabekov - Truck 296615 / Charlie Hunt
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Taalaibek Baabekov' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Charlie Hunt' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '296615', NULL, NULL, NULL,
  88000, NULL, 41000, 1000, 'weekly',
  NULL, NULL, '86dv577vy'
);

-- Record 86dw1b6u7: 1538 - Yiman Ysaev - Truck M97
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Yiman Ysaev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  'M97', NULL, NULL, NULL,
  127055, NULL, 78055, 1000, 'weekly',
  '2025-02-04', 'No down payment', '86dw1b6u7'
);

-- Record 86dwv4rfg: 1561 - Samuel Edoka / Truck M76
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Samuel Edoka' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Fully Paid' LIMIT 1),
  'cash',
  'M76', NULL, NULL, NULL,
  90000, NULL, 0, 1000, NULL,
  '2025-04-15', 'Total Value: $90,000.00
Down Payment: $50,000.00', '86dwv4rfg'
);

-- Record 86dx8g15j: 1740 - Urmatbek Abdiev - Truck 572
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Urmatbek Abdiev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '572', NULL, NULL, NULL,
  39200, NULL, 9200, 1000, 'weekly',
  '2025-05-14', NULL, '86dx8g15j'
);

-- Record 86dx93un3: Abdullaev Shakhzodbek | 1767 - Navfarbek Madaminov - Truck 60
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Abdullaev Shakhzodbek' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Navfarbek Madaminov' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '60', NULL, NULL, NULL,
  30000, NULL, 2500, 1000, 'weekly',
  '2025-07-08', 'See Safety Deposit

Total Value $30,000.00
Down Payment: $2,000.00', '86dx93un3'
);

-- Record 86dxfcy6a: 1789 - Bakytbek Tairov - Truck 296623
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Bakytbek Tairov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '296623', NULL, NULL, NULL,
  61600, NULL, 27100, 1000, 'weekly',
  '2025-07-30', 'Weekly $1000

Total Value: $68,600.00
Down Payment: $10,000.00
Zelle:  $3000 on 07/30/25
            $3000 on 07/31/25
            $1000 pending
Need to do 2 payroll deductions of $1500 each. Then $1000 weekly.', '86dxfcy6a'
);

-- Record 86dxwxnrg: 1831 - Baiel Soltonov - Truck TNC0255
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Baiel Soltonov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  'TNC0255', NULL, NULL, NULL,
  75000, NULL, 43000, 1000, 'weekly',
  '2025-09-16', 'Need to collect $15K for Down payment. Then $1K weekly.', '86dxwxnrg'
);

-- Record 86dy0ezq3: FO Almaz Osmonaliev / 1829 - Eshmukhamed Talaibekov / Sergot Peralte - Truck M78
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Almaz Osmonaliev' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Eshmukhamed Talaibekov' LIMIT 1), (SELECT id FROM drivers WHERE full_name = 'Sergot Peralte' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  'M78', NULL, NULL, NULL,
  77000, NULL, 48000, 1000, 'weekly',
  '2025-09-30', 'Total Value: $77,000.00
Down Payment: $15,000.00
Balance: $62,000.00', '86dy0ezq3'
);

-- Record 86drucwxt: 295 - Satybek Koilubaev - Trailer# 532191
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Satybek Koilubaev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '532191', NULL, NULL, NULL,
  33000, NULL, 15400, 400, 'weekly',
  '2024-02-27', 'Driver Purchased the Trailer for $30,000.00 on 02/27/2024
Made a downpayment of $6,000.00 via Zelle
Update: 07/09/24 - Per Ken: "he dont want to purchase that trailer anymore, instead of trailer 201806, he want to purchase trailer 532191. new price for 532191 $39k, so he will keep paying exact same amount"
Update on 03/24/25 - Per Luke: "Satybek sold his trailer to us 532191
also Satybek trying to sell his trailer himself too"', '86drucwxt'
);

-- Record 86dybjmn2: #1818 - Baktiiar Zhanybekov - Truck 855
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Baktiiar Zhanybekov' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '855', NULL, NULL, NULL,
  20025, NULL, 20000, NULL, 'weekly',
  '2025-08-20', 'The company helped Baktiiar to purchase the truck
The truck has a manual transmission, making it difficult to find another buyer or a driver, after Baktiiars legal issue.
Currently, the truck is parked at Aurora, and company will hold any paycheck from the driver.', '86dybjmn2'
);

-- Record 86dyry1na: 1898 - Jimmy Joselin - Truck 345
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Jimmy Joselin' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '345', NULL, NULL, NULL,
  65000, NULL, 45000, 1000, 'weekly',
  '2025-11-21', 'Start Payments on Week 50 Payroll. Once Down Payment is colleced.

TOTAL VALUE: $65,000.00
DOWN PAYMENT: $2,000.00 (Zelle 11/22/25) + $1,500.00 (Wk 48 Payroll + $1,500.00 (Wk 49 Payroll) + $5,000.00 (Zelle 03/10/26) + $1,000.00 (Zelle on 03/13/26)', '86dyry1na'
);

-- Record 86dyrz74e: 332 - Alex Aquino - Truck 88
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Alex Aquino' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '88', NULL, NULL, NULL,
  93000, NULL, 73000, 1000, 'weekly',
  '2025-11-21', 'TOTAL VALUE: $95,000.00
DOWN PAYMENT: $2,000.00', '86dyrz74e'
);

-- Record 86dzfhrqf: FO Almaz Osmonaliev - Truck# 296624
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Almaz Osmonaliev' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '296624', NULL, NULL, NULL,
  75000, NULL, 57000, 1000, 'weekly',
  '2025-10-22', NULL, '86dzfhrqf'
);

-- Record 86dzmprbz: 1909 - Kubanychbek Arzybai uulu - Truck 55
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Kubanychbek Arzybai Uulu' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '55', NULL, NULL, NULL,
  70000, NULL, 53000, 2000, 'weekly',
  '2026-01-26', 'Down payment $10K 5 times by $2K, then $1000 weekly

Total Value: $70,000.00
Down Payment: N/A. Need to collect $10K from 5 paychecks. Then $1000 weekly.', '86dzmprbz'
);

-- Record 86e00zfg9: 1269 - Odalien Odalus - Truck 58
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Odalien Odalus' LIMIT 1),
  ARRAY[]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '58', NULL, NULL, NULL,
  54777, NULL, 44299.3, 1000, 'weekly',
  '2026-02-19', 'Total Value: $54,777.00
Down Payment: $5,477.70 ( Collected from week 07 Payroll 2026)', '86e00zfg9'
);

-- Record 86dttbfgp: 1476 - Islam Bolotbaev / 378 - Altynbek Emilev - Truck# 580
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Islam Bolotbaev' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Altynbek Emilev' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '580', NULL, NULL, NULL,
  86349, NULL, 41500, 700, 'weekly',
  '2024-06-05', 'Weekly $700

Total Value: $96,349.00
Down Payment: $10,000.00
-------------------------------------
Balance: $86,349.00

Per Nuraly: Working a deal with Altynbek on solving the issue. On 04/23/26.', '86dttbfgp'
);

-- Record 86e0tjefr: 1896 - Christopher Louidor FO / 2047 - Fidelson Joseph - Truck 7717
INSERT INTO driver_purchases (
  driver_id, co_driver_ids, entity_id, status_id, purchase_type,
  truck_number, vin, equipment_id, underlying_loan_id,
  total_value, downpayment, current_balance, payment_amount, payment_frequency,
  purchase_date, notes, original_clickup_id
) VALUES (
  (SELECT id FROM drivers WHERE full_name = 'Christopher Louidor' LIMIT 1),
  ARRAY[(SELECT id FROM drivers WHERE full_name = 'Fidelson Joseph' LIMIT 1)]::uuid[],
  NULL,
  (SELECT id FROM driver_purchase_statuses WHERE name = 'Weekly Payments' LIMIT 1),
  'cash',
  '7717', NULL, NULL, NULL,
  75000, NULL, 65500, 1000, 'weekly',
  '2026-03-11', 'Total Value: $
Down Payment: $6500 (collected from Christopher Louidor Weeks 9 & 10)', '86e0tjefr'
);

-- =========================================================
-- STEP 3: events log entries
-- =========================================================

INSERT INTO driver_purchase_events (driver_purchase_id, event_type, description, metadata)
SELECT id, 'imported', 'Imported from ClickUp Phase 2B',
       jsonb_build_object('original_clickup_id', original_clickup_id)
FROM driver_purchases WHERE original_clickup_id IS NOT NULL
  AND created_at > now() - interval '5 minutes';

COMMIT;
