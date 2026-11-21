import { Controller, Get, Param, Query } from '@nestjs/common';
import { DashboardService, Filtros } from './dashboard.service';

// Filtros comuns por query string: ?ano=2026&uf=ES&id_municipio=10&catmat=267510&esfera=MUNICIPAL&tp_compra=JUDICIAL
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dash: DashboardService) {}

  @Get('filtros')
  filtros() {
    return this.dash.filtros();
  }

  @Get('medicamentos')
  medicamentos(@Query('q') q: string) {
    return this.dash.buscarMedicamentos(q);
  }

  @Get('mapa/estados')
  mapaEstados(@Query() f: Filtros) {
    return this.dash.mapaEstados(f);
  }

  @Get('mapa/estados/:uf/municipios')
  mapaMunicipios(@Param('uf') uf: string, @Query() f: Filtros) {
    return this.dash.mapaMunicipios(uf, f);
  }

  @Get('mapa/resumo')
  mapaResumo(@Query() f: Filtros) {
    return this.dash.mapaResumo(f);
  }

  @Get('precos/:catmat/unidades')
  precoUnidades(@Param('catmat') catmat: string, @Query() f: Filtros) {
    return this.dash.precoUnidades(catmat, f);
  }

  @Get('precos/:catmat')
  preco(@Param('catmat') catmat: string, @Query() f: Filtros & { un?: string }) {
    return this.dash.preco(catmat, f.un, f);
  }

  @Get('sobrepreco')
  sobrepreco(@Query() f: Filtros & { fator?: string; min_amostra?: string; limite?: string }) {
    return this.dash.sobrepreco(f);
  }

  @Get('mercado')
  mercado(@Query() f: Filtros) {
    return this.dash.mercado(f);
  }
}
