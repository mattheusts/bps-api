const PESOS_D1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_D2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function digito(base: string, pesos: number[]): number {
  const soma = base.split('').reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Valida os dois dígitos verificadores do CNPJ (módulo 11). */
export function validarCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const d1 = digito(cnpj.slice(0, 12), PESOS_D1);
  const d2 = digito(cnpj.slice(0, 12) + d1, PESOS_D2);
  return cnpj.endsWith(`${d1}${d2}`);
}
