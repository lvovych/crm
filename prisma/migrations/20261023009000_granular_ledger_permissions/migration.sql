-- Preserve existing explicitly granted capabilities; never grant admin-only powers.
INSERT INTO permissions(id,action,subject,"roleId")
SELECT md5(p.id||':'||v.action),v.action,p.subject,p."roleId"
FROM permissions p CROSS JOIN (VALUES ('post'),('reserve'),('issue')) v(action)
WHERE p.subject='stock_ledger' AND p.action='manage'
ON CONFLICT ("roleId",action,subject) DO NOTHING;
INSERT INTO permissions(id,action,subject,"roleId")
SELECT md5(id||':post'),'post',subject,"roleId" FROM permissions WHERE subject='supplier_finance' AND action='create'
ON CONFLICT ("roleId",action,subject) DO NOTHING;
INSERT INTO permissions(id,action,subject,"roleId")
SELECT md5(id||':allocate'),'allocate',subject,"roleId" FROM permissions WHERE subject='supplier_finance' AND action='manage'
ON CONFLICT ("roleId",action,subject) DO NOTHING;
