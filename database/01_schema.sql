-- =====================================================================
-- Banco de Preços em Saúde (BPS) - esquema físico MySQL 8.0.16+
-- Gerado a partir do modelo lógico (mdr_pdm). Diferenças em relação ao
-- diagrama estão marcadas com [AJUSTE] e explicadas no README.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS bps
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE bps;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS item_compra, processo_compra, usuario, medicamento, pdm,
  instituicao, fornecedor, fabricante, municipio, estado;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE estado (
  id_estado  INT         NOT NULL AUTO_INCREMENT,
  sg_uf      CHAR(2)     NOT NULL,
  no_estado  VARCHAR(30) NOT NULL,
  CONSTRAINT pk_estado PRIMARY KEY (id_estado),
  CONSTRAINT uk_estado_sg_uf UNIQUE (sg_uf),
  CONSTRAINT uk_estado_no_estado UNIQUE (no_estado),
  CONSTRAINT ck_estado_sg_uf CHECK (sg_uf REGEXP '^[A-Z]{2}$')
) ENGINE = InnoDB;

CREATE TABLE municipio (
  id_municipio INT         NOT NULL AUTO_INCREMENT,
  co_ibge      INT         NULL,
  no_municipio VARCHAR(60) NOT NULL,
  id_estado    INT         NOT NULL,
  CONSTRAINT pk_municipio PRIMARY KEY (id_municipio),
  CONSTRAINT uk_municipio_co_ibge UNIQUE (co_ibge),
  CONSTRAINT uk_municipio_nome_estado UNIQUE (no_municipio, id_estado),
  CONSTRAINT fk_municipio_estado FOREIGN KEY (id_estado)
    REFERENCES estado (id_estado) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE fabricante (
  id_fabricante   INT          NOT NULL AUTO_INCREMENT,
  cnpj_fabricante CHAR(14)     NOT NULL,
  no_fabricante   VARCHAR(150) NOT NULL,
  CONSTRAINT pk_fabricante PRIMARY KEY (id_fabricante),
  CONSTRAINT uk_fabricante_cnpj UNIQUE (cnpj_fabricante),
  CONSTRAINT ck_fabricante_cnpj CHECK (cnpj_fabricante REGEXP '^[0-9]{14}$')
) ENGINE = InnoDB;

CREATE TABLE fornecedor (
  id_fornecedor   INT          NOT NULL AUTO_INCREMENT,
  cnpj_fornecedor CHAR(14)     NOT NULL,
  no_fornecedor   VARCHAR(150) NOT NULL,
  CONSTRAINT pk_fornecedor PRIMARY KEY (id_fornecedor),
  CONSTRAINT uk_fornecedor_cnpj UNIQUE (cnpj_fornecedor),
  CONSTRAINT ck_fornecedor_cnpj CHECK (cnpj_fornecedor REGEXP '^[0-9]{14}$')
) ENGINE = InnoDB;

CREATE TABLE instituicao (
  id_instituicao   INT          NOT NULL AUTO_INCREMENT,
  cnpj_instituicao CHAR(14)     NOT NULL,
  no_instituicao   VARCHAR(150) NOT NULL,
  ds_esfera        VARCHAR(20)  NOT NULL,
  id_municipio     INT          NOT NULL,
  CONSTRAINT pk_instituicao PRIMARY KEY (id_instituicao),
  CONSTRAINT uk_instituicao_cnpj UNIQUE (cnpj_instituicao),
  CONSTRAINT ck_instituicao_cnpj CHECK (cnpj_instituicao REGEXP '^[0-9]{14}$'),
  CONSTRAINT fk_instituicao_municipio FOREIGN KEY (id_municipio)
    REFERENCES municipio (id_municipio) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE usuario (
  id_usuario     INT          NOT NULL AUTO_INCREMENT,
  no_usuario     VARCHAR(150) NOT NULL,
  ds_email       VARCHAR(150) NOT NULL,
  ds_senha_hash  VARCHAR(255) NOT NULL,
  tp_perfil      VARCHAR(20)  NOT NULL,
  fg_ativo       CHAR(1)      NOT NULL DEFAULT 'S',
  dt_cadastro    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_instituicao INT          NULL,
  CONSTRAINT pk_usuario PRIMARY KEY (id_usuario),
  CONSTRAINT uk_usuario_email UNIQUE (ds_email),
  CONSTRAINT ck_usuario_perfil CHECK (tp_perfil IN ('ADMIN', 'OPERADOR', 'CONSULTA')),
  CONSTRAINT ck_usuario_ativo CHECK (fg_ativo IN ('S', 'N')),
  CONSTRAINT fk_usuario_instituicao FOREIGN KEY (id_instituicao)
    REFERENCES instituicao (id_instituicao) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE pdm (
  id_pdm    INT          NOT NULL AUTO_INCREMENT,
  co_pdm    INT          NOT NULL,
  no_pdm    VARCHAR(60)  NOT NULL,
  co_classe INT          NOT NULL,
  no_classe VARCHAR(100) NOT NULL, -- [AJUSTE] era 60; o CSV tem nomes de classe com 80 caracteres
  CONSTRAINT pk_pdm PRIMARY KEY (id_pdm),
  CONSTRAINT uk_pdm_co_pdm UNIQUE (co_pdm)
) ENGINE = InnoDB;

CREATE TABLE medicamento (
  id_medicamento INT          NOT NULL AUTO_INCREMENT,
  co_catmat      INT          NOT NULL,
  ds_item        VARCHAR(600) NOT NULL, -- [AJUSTE] era 450; o CSV tem descrições com 540 caracteres
  id_pdm         INT          NOT NULL,
  CONSTRAINT pk_medicamento PRIMARY KEY (id_medicamento),
  CONSTRAINT uk_medicamento_co_catmat UNIQUE (co_catmat),
  CONSTRAINT fk_medicamento_pdm FOREIGN KEY (id_pdm)
    REFERENCES pdm (id_pdm) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE processo_compra (
  id_processo_compra  INT         NOT NULL AUTO_INCREMENT,
  id_instituicao      INT         NOT NULL,
  id_usuario_cadastro INT         NOT NULL,
  nu_processo_compra  VARCHAR(30) NOT NULL,
  nu_ata              VARCHAR(30) NULL,
  ano_compra          SMALLINT    NOT NULL,
  dt_compra           DATE        NOT NULL,
  tp_compra           VARCHAR(20) NOT NULL,
  modalidade          VARCHAR(40) NOT NULL,
  validade_compra     SMALLINT    NOT NULL,
  CONSTRAINT pk_processo_compra PRIMARY KEY (id_processo_compra),
  CONSTRAINT ck_processo_ano CHECK (ano_compra BETWEEN 2000 AND 2100),
  CONSTRAINT ck_processo_validade CHECK (validade_compra > 0),
  CONSTRAINT fk_processo_compra_instituicao FOREIGN KEY (id_instituicao)
    REFERENCES instituicao (id_instituicao) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_processo_compra_usuario FOREIGN KEY (id_usuario_cadastro)
    REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX ix_processo_compra_ano (ano_compra),
  INDEX ix_processo_compra_dt (dt_compra),
  -- usado pelo importador para achar um processo já existente
  INDEX ix_processo_compra_nu (id_instituicao, nu_processo_compra, ano_compra)
) ENGINE = InnoDB;

CREATE TABLE item_compra (
  id_item_compra       BIGINT        NOT NULL AUTO_INCREMENT,
  co_seq_bps           BIGINT        NOT NULL,
  id_processo_compra   INT           NOT NULL,
  id_medicamento       INT           NOT NULL,
  id_fornecedor        INT           NOT NULL,
  id_fabricante        INT           NOT NULL,
  id_usuario_insercao  INT           NOT NULL,
  dt_insercao          DATE          NOT NULL,
  fg_generico          CHAR(1)       NULL,
  registro_anvisa      VARCHAR(20)   NULL,
  un_fornecimento      VARCHAR(20)   NULL,
  un_medida_capacidade VARCHAR(30)   NULL,
  sg_unidade_medida    VARCHAR(10)   NULL,
  vl_capacidade        DECIMAL(12,2) NULL,
  qt_medicamento       INT           NOT NULL,
  vl_preco_unitario    DECIMAL(12,4) NOT NULL,
  vl_preco_total       DECIMAL(16,2) NOT NULL,
  ds_observacao        TEXT          NULL,
  CONSTRAINT pk_item_compra PRIMARY KEY (id_item_compra),
  CONSTRAINT uk_item_compra_co_seq_bps UNIQUE (co_seq_bps),
  CONSTRAINT ck_item_generico CHECK (fg_generico IS NULL OR fg_generico IN ('S', 'N')),
  CONSTRAINT ck_item_qt CHECK (qt_medicamento > 0),
  CONSTRAINT ck_item_preco CHECK (vl_preco_unitario >= 0 AND vl_preco_total >= 0),
  CONSTRAINT fk_item_compra_processo FOREIGN KEY (id_processo_compra)
    REFERENCES processo_compra (id_processo_compra) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_item_compra_medicamento FOREIGN KEY (id_medicamento)
    REFERENCES medicamento (id_medicamento) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_item_compra_fornecedor FOREIGN KEY (id_fornecedor)
    REFERENCES fornecedor (id_fornecedor) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_item_compra_fabricante FOREIGN KEY (id_fabricante)
    REFERENCES fabricante (id_fabricante) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_item_compra_usuario FOREIGN KEY (id_usuario_insercao)
    REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;
