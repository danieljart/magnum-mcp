-- Tab viagens
CREATE TABLE IF NOT EXISTS viagens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_saida DATE NOT NULL,
    origem TEXT NOT NULL,
    destino TEXT NOT NULL,
    valor_base NUMERIC NOT NULL,
    vagas_total INTEGER NOT NULL,
    vagas_disponiveis INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO', 'ESGOTADO', 'CANCELADO')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela reservas
CREATE TABLE IF NOT EXISTS reservas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_reserva TEXT UNIQUE NOT NULL,
    viagem_id UUID REFERENCES viagens(id) NOT NULL,
    nome_cliente TEXT NOT NULL,
    telefone TEXT NOT NULL,
    quantidade INTEGER NOT NULL,
    valor_total NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'PAGO', 'CANCELADO')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Função RPC para criar reserva com trava de segurança
CREATE OR REPLACE FUNCTION criar_reserva(
    p_viagem_id UUID,
    p_nome_cliente TEXT,
    p_telefone TEXT,
    p_quantidade INTEGER
)
RETURNS JSON AS $$
DECLARE
    v_vagas_disponiveis INTEGER;
    v_valor_base NUMERIC;
    v_codigo_reserva TEXT;
    v_reserva_id UUID;
BEGIN
    -- Bloquear a linha da viagem para evitar concorrência (FOR UPDATE)
    SELECT vagas_disponiveis, valor_base 
    INTO v_vagas_disponiveis, v_valor_base
    FROM viagens 
    WHERE id = p_viagem_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Viagem não encontrada');
    END IF;

    -- Verificar disponibilidade
    IF v_vagas_disponiveis < p_quantidade THEN
        RETURN json_build_object('success', false, 'message', 'Vagas insuficientes');
    END IF;

    -- Gerar código aleatório MAG-XXXXXX
    v_codigo_reserva := 'MAG-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 6));

    -- Atualizar vagas
    UPDATE viagens 
    SET vagas_disponiveis = vagas_disponiveis - p_quantidade,
        status = CASE WHEN (vagas_disponiveis - p_quantidade) = 0 THEN 'ESGOTADO' ELSE status END
    WHERE id = p_viagem_id;

    -- Inserir reserva
    INSERT INTO reservas (viagem_id, nome_cliente, telefone, quantidade, valor_total, codigo_reserva)
    VALUES (p_viagem_id, p_nome_cliente, p_telefone, p_quantidade, v_valor_base * p_quantidade, v_codigo_reserva)
    RETURNING id INTO v_reserva_id;

    RETURN json_build_object(
        'success', true, 
        'codigo_reserva', v_codigo_reserva,
        'reserva_id', v_reserva_id
    );
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql;
