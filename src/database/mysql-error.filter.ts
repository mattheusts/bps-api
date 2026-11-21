import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

interface MysqlError {
  code?: string;
  errno?: number;
  sqlMessage?: string;
}

/**
 * Traduz erros do MySQL em respostas HTTP compreensíveis.
 * Sem isso, violar uma UNIQUE ou uma FK vira um "500 Internal Server Error" genérico.
 */
@Catch()
export class MysqlErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Erro');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(this.corpo(exception.getResponse()));
      return;
    }

    const err = exception as MysqlError;
    const msg = err.sqlMessage ?? '';
    switch (err.errno) {
      case 1062: // ER_DUP_ENTRY
        res.status(HttpStatus.CONFLICT).json({ message: `Já existe um registro com esse valor (${this.chave(msg)}).` });
        return;
      case 1451: // ER_ROW_IS_REFERENCED_2
        res.status(HttpStatus.CONFLICT).json({
          message: `Não é possível excluir: o registro é usado em ${this.tabelaReferenciadora(msg)}.`,
        });
        return;
      case 1452: // ER_NO_REFERENCED_ROW_2
        res.status(HttpStatus.BAD_REQUEST).json({ message: 'Referência inválida: o registro relacionado não existe.' });
        return;
      case 3819: // ER_CHECK_CONSTRAINT_VIOLATED
        res.status(HttpStatus.BAD_REQUEST).json({ message: `Valor fora da regra: ${this.chave(msg)}.` });
        return;
      case 1406: // ER_DATA_TOO_LONG
        res.status(HttpStatus.BAD_REQUEST).json({ message: `Valor maior que o permitido: ${msg}` });
        return;
      case 1048: // ER_BAD_NULL_ERROR
        res.status(HttpStatus.BAD_REQUEST).json({ message: `Campo obrigatório: ${msg}` });
        return;
    }

    this.logger.error(exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Erro interno.' });
  }

  private corpo(r: string | object): object {
    return typeof r === 'string' ? { message: r } : r;
  }

  /** Extrai o nome da constraint da mensagem do MySQL, ex.: uk_fabricante_cnpj. */
  private chave(msg: string): string {
    const m = msg.match(/(?:key|constraint) '([^']+)'/i);
    return m ? m[1].replace(/^.*\./, '') : msg;
  }

  private tabelaReferenciadora(msg: string): string {
    const m = msg.match(/\(`[^`]+`\.`([^`]+)`/);
    return m ? m[1] : 'outra tabela';
  }
}
