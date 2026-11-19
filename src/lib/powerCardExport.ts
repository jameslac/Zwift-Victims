import {
  computeNiceYScale,
  formatEffortPrimary,
  formatEffortSecondary,
  getEffortMetricValue,
  pickLogAxisTicks,
} from './powerBests';
import type {
  PowerBestRow,
  PowerMetricUnit,
  PowerSeriesConfig,
} from './powerBests';

export interface PowerCardExportInput {
  riderName: string;
  weightLabel?: string;
  ftp?: number;
  zftp?: number;
  zmap?: number;
  vo2max?: number;
  unit: PowerMetricUnit;
  series: readonly PowerSeriesConfig[];
  rows: PowerBestRow[];
  allRows: PowerBestRow[];
  generatedAt?: Date;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function buildStatPills(input: PowerCardExportInput): Array<{ label: string; value: string }> {
  const pills: Array<{ label: string; value: string }> = [];
  if (input.ftp) pills.push({ label: 'FTP', value: `${Math.round(input.ftp)} W` });
  if (input.zftp !== undefined) pills.push({ label: 'zFTP', value: `${Math.round(input.zftp)} W` });
  if (input.zmap !== undefined) pills.push({ label: 'zMAP', value: `${Math.round(input.zmap)} W` });
  if (input.vo2max !== undefined) {
    pills.push({ label: 'VO2max', value: input.vo2max.toFixed(1) });
  }
  if (input.weightLabel && input.weightLabel !== '—') {
    pills.push({ label: 'Weight', value: input.weightLabel });
  }
  return pills;
}

export function formatPowerBestsText(input: PowerCardExportInput): string {
  const lines: string[] = [];
  const dateStr = (input.generatedAt ?? new Date()).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  });
  lines.push(`${input.riderName} — Zwift Power Bests (${dateStr})`);

  const stats = buildStatPills(input);
  if (stats.length > 0) {
    lines.push(stats.map((s) => `${s.label}: ${s.value}`).join(' | '));
  }
  lines.push('');

  let hasSustainedAvg = false;
  for (const row of input.rows) {
    const parts: string[] = [];
    for (const s of input.series) {
      const effort = row[s.key];
      if (!effort || (effort.watts === undefined && effort.wkg === undefined)) continue;
      const primary = formatEffortPrimary(effort, input.unit);
      const secondary = formatEffortSecondary(effort, input.unit);
      const star = s.key === 'zpRaceBest' && effort.isSustainedRaceAvg ? '*' : '';
      if (star) hasSustainedAvg = true;
      parts.push(`${s.label}: ${primary}${secondary ? ` (${secondary})` : ''}${star}`);
    }
    if (parts.length > 0) {
      lines.push(`${row.label.padEnd(13)} ${parts.join(' · ')}`);
    }
  }

  if (hasSustainedAvg) {
    lines.push('');
    lines.push('* ZwiftPower sustained full-race avg (race duration >= interval)');
  }
  return lines.join('\n');
}

export async function renderPowerCardPngBlob(input: PowerCardExportInput): Promise<Blob> {
  const SCALE = 2;
  const W = 920;
  const OUTER_PAD = 28;
  const INNER_PAD = 28;
  const CARD_X = OUTER_PAD;
  const CARD_Y = OUTER_PAD;
  const CARD_W = W - OUTER_PAD * 2;
  const CONTENT_X = CARD_X + INNER_PAD;
  const CONTENT_W = CARD_W - INNER_PAD * 2;

  const statPills = buildStatPills(input);
  const hasSustainedAvg = input.rows.some(
    (r) => input.series.some((s) => s.key === 'zpRaceBest') && r.zpRaceBest?.isSustainedRaceAvg,
  );

  const HEADER_H = statPills.length > 0 ? 116 : 74;
  const CHART_H = 182;
  const TABLE_HEADER_H = 34;
  const ROW_H = 32;
  const TABLE_H = TABLE_HEADER_H + Math.max(1, input.rows.length) * ROW_H;
  const FOOTNOTE_H = hasSustainedAvg ? 26 : 0;
  const FOOTER_H = 34;
  const CARD_H = INNER_PAD + HEADER_H + 18 + CHART_H + 18 + TABLE_H + FOOTNOTE_H + FOOTER_H + 14;
  const H = CARD_H + OUTER_PAD * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'middle';

  // Outer backdrop
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  // Card frame
  drawRoundedRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 20);
  ctx.fillStyle = '#020617';
  ctx.fill();
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  let cursorY = CARD_Y + INNER_PAD;

  // Brand badge + date
  drawRoundedRect(ctx, CONTENT_X, cursorY, 120, 24, 12);
  ctx.fillStyle = '#fc6719';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ZWIFT VICTIMS', CONTENT_X + 60, cursorY + 12.5);

  const dateStr = (input.generatedAt ?? new Date()).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  });
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Power Bests · ${dateStr}`, CONTENT_X + CONTENT_W, cursorY + 12.5);

  cursorY += 44;

  // Rider name
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 26px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(input.riderName, CONTENT_X, cursorY);

  cursorY += 28;

  // Stat pills
  if (statPills.length > 0) {
    let pillX = CONTENT_X;
    const pillH = 30;
    for (const pill of statPills) {
      const text = `${pill.label}  ${pill.value}`;
      ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
      const pillW = Math.ceil(ctx.measureText(text).width) + 22;
      drawRoundedRect(ctx, pillX, cursorY, pillW, pillH, 8);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(pill.label, pillX + 10, cursorY + pillH / 2 + 0.5);
      const labelW = ctx.measureText(`${pill.label}  `).width;
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.fillText(pill.value, pillX + 10 + labelW, cursorY + pillH / 2 + 0.5);

      pillX += pillW + 8;
    }
    cursorY += 44;
  }

  cursorY += 18;

  // Mini chart box
  const chartBoxY = cursorY;
  drawRoundedRect(ctx, CONTENT_X, chartBoxY, CONTENT_W, CHART_H, 14);
  ctx.fillStyle = '#0b1222';
  ctx.fill();
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Legend along top of chart box
  let legX = CONTENT_X + 16;
  const legY = chartBoxY + 18;
  for (const s of input.series) {
    ctx.beginPath();
    ctx.arc(legX + 4, legY, 4, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(s.label, legX + 13, legY + 0.5);
    legX += Math.ceil(ctx.measureText(s.label).width) + 30;
  }

  const plotRows = input.allRows.filter((row) =>
    input.series.some((s) => getEffortMetricValue(row[s.key], input.unit) !== undefined),
  );
  const markedSet = new Set(input.rows.map((r) => r.seconds));

  if (plotRows.length > 0) {
    const plotX = CONTENT_X + 48;
    const plotY = chartBoxY + 34;
    const plotW = CONTENT_W - 68;
    const plotH = CHART_H - 64;

    let maxVal = 0;
    for (const row of plotRows) {
      for (const s of input.series) {
        const val = getEffortMetricValue(row[s.key], input.unit);
        if (val !== undefined && val > maxVal) maxVal = val;
      }
    }
    const { maxY, ticks: yTicks } = computeNiceYScale(maxVal, input.unit);

    const minLog = Math.log(plotRows[0].seconds);
    const maxLog = Math.log(plotRows[plotRows.length - 1].seconds);
    const logSpan = maxLog - minLog || 1;
    const xFor = (sec: number) => plotX + ((Math.log(sec) - minLog) / logSpan) * plotW;
    const yFor = (val: number) => plotY + plotH - (Math.min(val, maxY) / maxY) * plotH;

    // Horizontal gridlines
    for (const tick of yTicks) {
      const y = yFor(tick);
      ctx.beginPath();
      ctx.setLineDash(tick === 0 ? [] : [3, 4]);
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#64748b';
      ctx.font = '500 10px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        input.unit === 'watts' ? `${Math.round(tick)}W` : tick.toFixed(0),
        plotX - 8,
        y + 0.5,
      );
    }

    // X-axis ticks
    const xTicks = pickLogAxisTicks(plotRows, xFor, 46);
    for (const row of xTicks) {
      const x = xFor(row.seconds);
      ctx.beginPath();
      ctx.moveTo(x, plotY);
      ctx.lineTo(x, plotY + plotH);
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '500 10px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(row.shortLabel, x, plotY + plotH + 14);
    }

    // Draw series lines + marked dots
    for (const s of input.series) {
      const pts = plotRows
        .map((row) => {
          const val = getEffortMetricValue(row[s.key], input.unit);
          if (val === undefined) return null;
          return {
            row,
            effort: row[s.key]!,
            x: xFor(row.seconds),
            y: yFor(val),
          };
        })
        .filter((pt): pt is NonNullable<typeof pt> => pt !== null);

      if (pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2.25;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      for (const pt of pts) {
        if (!markedSet.has(pt.row.seconds)) continue;
        const isHollow = Boolean(pt.effort.isSustainedRaceAvg);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = isHollow ? '#020617' : s.color;
        ctx.fill();
        ctx.strokeStyle = isHollow ? s.color : '#020617';
        ctx.lineWidth = isHollow ? 2 : 1.25;
        ctx.stroke();
      }
    }
  }

  cursorY += CHART_H + 18;

  // Table container
  const tableX = CONTENT_X;
  const tableY = cursorY;
  drawRoundedRect(ctx, tableX, tableY, CONTENT_W, TABLE_H, 12);
  ctx.fillStyle = '#0b1222';
  ctx.fill();
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.stroke();

  const durColW = 148;
  const seriesCount = Math.max(1, input.series.length);
  const seriesColW = (CONTENT_W - durColW) / seriesCount;

  // Table header
  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('DURATION', tableX + 16, tableY + TABLE_HEADER_H / 2);

  input.series.forEach((s, idx) => {
    const colX = tableX + durColW + idx * seriesColW;
    ctx.beginPath();
    ctx.arc(colX + 4, tableY + TABLE_HEADER_H / 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();

    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(s.label.toUpperCase(), colX + 14, tableY + TABLE_HEADER_H / 2);
  });

  // Header divider
  ctx.beginPath();
  ctx.moveTo(tableX, tableY + TABLE_HEADER_H);
  ctx.lineTo(tableX + CONTENT_W, tableY + TABLE_HEADER_H);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Table rows
  input.rows.forEach((row, rowIdx) => {
    const rowY = tableY + TABLE_HEADER_H + rowIdx * ROW_H;
    if (rowIdx > 0) {
      ctx.beginPath();
      ctx.moveTo(tableX + 12, rowY);
      ctx.lineTo(tableX + CONTENT_W - 12, rowY);
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const midY = rowY + ROW_H / 2 + 0.5;
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(row.label, tableX + 16, midY);

    input.series.forEach((s, sIdx) => {
      const colX = tableX + durColW + sIdx * seriesColW;
      const effort = row[s.key];
      const primary = formatEffortPrimary(effort, input.unit);
      const secondary = formatEffortSecondary(effort, input.unit);
      const star = s.key === 'zpRaceBest' && effort?.isSustainedRaceAvg ? '*' : '';

      if (primary === '—') {
        ctx.fillStyle = '#475569';
        ctx.font = '500 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
        ctx.fillText('—', colX, midY);
      } else {
        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 12.5px ui-sans-serif, system-ui, -apple-system, sans-serif';
        const primaryStr = `${primary}${star}`;
        ctx.fillText(primaryStr, colX, midY);
        if (secondary) {
          const primaryW = ctx.measureText(primaryStr).width;
          ctx.fillStyle = '#94a3b8';
          ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
          ctx.fillText(`  ${secondary}`, colX + primaryW, midY);
        }
      }
    });
  });

  if (hasSustainedAvg) {
    ctx.fillStyle = '#64748b';
    ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      '* ZwiftPower sustained full-race average over races >= duration',
      CONTENT_X,
      cursorY + TABLE_H + 16,
    );
  }

  // Card footer
  ctx.fillStyle = '#64748b';
  ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Generated by Zwift Victims', CONTENT_X + CONTENT_W, CARD_Y + CARD_H - 18);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to render PNG image.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}
