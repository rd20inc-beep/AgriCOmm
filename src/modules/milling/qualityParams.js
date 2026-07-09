// Pakistani-rice per-grade quality split. Stored on milling_quality_samples
// in snake_case (b1_pct / b2_pct / cobba_pct / csr_pct / nb_pct / ov_pct);
// FE uses camelCase via the standard transformKeys pipeline.
// Shared by the regular batch page and the dedicated service-milling page.
export const qualityParams = [
  // Aggregate metrics
  { key: 'moisture',       label: 'Moisture %',       unit: '%', backendKey: 'moisture' },
  { key: 'broken',         label: 'Broken %',         unit: '%', backendKey: 'broken' },
  { key: 'foreignMatter',  label: 'Foreign matter %', unit: '%', backendKey: 'foreign_matter' },
  { key: 'chalky',         label: 'Chalky %',         unit: '%', backendKey: 'chalky' },
  { key: 'purity',         label: 'Purity %',         unit: '%', backendKey: 'purity' },
  // Pakistani broken-grade breakdown
  { key: 'b1Pct',          label: 'B-1',              unit: '%', backendKey: 'b1_pct' },
  { key: 'b2Pct',          label: 'B-2',              unit: '%', backendKey: 'b2_pct' },
  { key: 'b3Pct',          label: 'B-3',              unit: '%', backendKey: 'b3_pct' },
  { key: 'csrPct',         label: 'C.S',              unit: '%', backendKey: 'csr_pct' },
  { key: 'shortGrainPct',  label: 'Short Grain',      unit: '%', backendKey: 'short_grain_pct' },
  { key: 'cobbaPct',       label: 'Choba',            unit: '%', backendKey: 'cobba_pct' },
  { key: 'nbPct',          label: 'N.B',              unit: '%', backendKey: 'nb_pct' },
  { key: 'ovPct',          label: 'O.V',              unit: '%', backendKey: 'ov_pct' },
];

export default qualityParams;
