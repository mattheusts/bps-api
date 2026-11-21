import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createPool, Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { config } from '../config';

/** Algo capaz de executar SQL: o pool ou uma conexão dentro de transação. */
export interface Executor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger('SQL');
  readonly pool: Pool;

  constructor() {
    this.pool = createPool({
      ...config.db,
      connectionLimit: 10,
      charset: 'utf8mb4',
      decimalNumbers: true, // DECIMAL volta como number, não como string
      dateStrings: true, // DATE volta como 'AAAA-MM-DD', sem conversão de fuso
    });
  }

  /** SELECT: devolve as linhas. */
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = [], ex: Executor = this.pool): Promise<T[]> {
    this.log(sql, params);
    const [rows] = (await ex.query(sql, params)) as [unknown, unknown];
    return rows as T[];
  }

  /** SELECT que deve devolver no máximo uma linha. */
  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = [], ex: Executor = this.pool): Promise<T | null> {
    const rows = await this.query<T>(sql, params, ex);
    return rows[0] ?? null;
  }

  /** INSERT/UPDATE/DELETE: devolve insertId e affectedRows. */
  async execute(sql: string, params: unknown[] = [], ex: Executor = this.pool): Promise<ResultSetHeader> {
    this.log(sql, params);
    const [res] = (await ex.query(sql, params)) as [ResultSetHeader, unknown];
    return res;
  }

  async transaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private log(sql: string, params: unknown[]): void {
    if (config.logSql) {
      this.logger.debug(`${sql.replace(/\s+/g, ' ').trim()} -- ${JSON.stringify(params)}`);
    }
  }
}
