USE bps;

-- As 27 unidades da federação. O CSV do BPS traz só a sigla (sg_uf),
-- então o nome do estado vem daqui.
INSERT INTO estado (sg_uf, no_estado) VALUES
  ('AC', 'Acre'), ('AL', 'Alagoas'), ('AP', 'Amapá'), ('AM', 'Amazonas'),
  ('BA', 'Bahia'), ('CE', 'Ceará'), ('DF', 'Distrito Federal'),
  ('ES', 'Espírito Santo'), ('GO', 'Goiás'), ('MA', 'Maranhão'),
  ('MT', 'Mato Grosso'), ('MS', 'Mato Grosso do Sul'), ('MG', 'Minas Gerais'),
  ('PA', 'Pará'), ('PB', 'Paraíba'), ('PR', 'Paraná'), ('PE', 'Pernambuco'),
  ('PI', 'Piauí'), ('RJ', 'Rio de Janeiro'), ('RN', 'Rio Grande do Norte'),
  ('RS', 'Rio Grande do Sul'), ('RO', 'Rondônia'), ('RR', 'Roraima'),
  ('SC', 'Santa Catarina'), ('SP', 'São Paulo'), ('SE', 'Sergipe'),
  ('TO', 'Tocantins')
ON DUPLICATE KEY UPDATE no_estado = VALUES(no_estado);
