(function () {
  "use strict";

  const fmtInt = new Intl.NumberFormat("en-US");
  const fmtPct = (v) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);

  const state = {
    dataset: null,
    quarterKeys: [],
    officeIndex: [], // [{code, name, state}]
    selectedCode: "TOTAL",
    charts: {},
  };

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---------- Fiscal-year axis bands ----------
  // Draws alternating background shading behind each fiscal year's quarters,
  // plus a centered "FYxxxx" label in a reserved strip below the Q1-Q4 tick
  // labels. Registered once globally; each chart opts in by setting
  // options.plugins.yearBands.fiscalYears.
  const yearBandsPlugin = {
    id: "yearBands",
    beforeDraw(chart, _args, opts) {
      const fiscalYears = opts.fiscalYears;
      if (!fiscalYears || !fiscalYears.length) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      if (!chartArea) return;
      const n = fiscalYears.length;
      const step = n > 1 ? xScale.getPixelForValue(1) - xScale.getPixelForValue(0) : chartArea.width;
      ctx.save();
      let i = 0;
      let bandIndex = 0;
      while (i < n) {
        let j = i;
        while (j + 1 < n && fiscalYears[j + 1] === fiscalYears[i]) j++;
        if (bandIndex % 2 === 1) {
          const left = xScale.getPixelForValue(i) - step / 2;
          const right = xScale.getPixelForValue(j) + step / 2;
          ctx.fillStyle = opts.bandColor || "rgba(0,0,0,0.03)";
          ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
        }
        i = j + 1;
        bandIndex++;
      }
      ctx.restore();
    },
    afterDraw(chart, _args, opts) {
      const fiscalYears = opts.fiscalYears;
      if (!fiscalYears || !fiscalYears.length) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      if (!chartArea) return;
      const n = fiscalYears.length;
      const labelBandHeight = opts.labelBandHeight || 16;
      ctx.save();
      ctx.fillStyle = opts.labelColor || "#898781";
      ctx.font = opts.font || "10px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const y = xScale.bottom - labelBandHeight + 2;
      const minGap = 6;
      let prevRightEdge = -Infinity;
      let i = 0;
      while (i < n) {
        let j = i;
        while (j + 1 < n && fiscalYears[j + 1] === fiscalYears[i]) j++;
        const cx = (xScale.getPixelForValue(i) + xScale.getPixelForValue(j)) / 2;
        const text = `FY${fiscalYears[i]}`;
        const halfWidth = ctx.measureText(text).width / 2;
        // Skip (don't draw) a label that would collide with the previous
        // one -- same overlap-avoidance idea as Chart.js's own tick
        // autoSkip, which this custom-drawn row doesn't get for free.
        if (cx - halfWidth >= prevRightEdge + minGap) {
          ctx.fillText(text, cx, y);
          prevRightEdge = cx + halfWidth;
        }
        i = j + 1;
      }
      ctx.restore();
    },
  };
  Chart.register(yearBandsPlugin);

  function fiscalYearsArray() {
    return state.quarterKeys.map((k) => state.dataset.quarters[k].fy);
  }

  function yearBandsOptions() {
    return {
      fiscalYears: fiscalYearsArray(),
      bandColor: cssVar("--year-band"),
      labelColor: cssVar("--text-muted"),
    };
  }

  // ---------- Theme ----------
  function initTheme() {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const currentlyDark = current ? current === "dark" : prefersDark;
      const next = currentlyDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
      renderAll();
    });
  }

  // ---------- Data loading ----------
  async function loadData() {
    const res = await fetch("data/n400_quarterly.json");
    const dataset = await res.json();
    state.dataset = dataset;
    state.quarterKeys = Object.keys(dataset.quarters); // already chronological from ingest script

    // Union offices across every quarter (not just the latest) so offices that
    // closed or were renamed earlier in the 2015-2026 span stay selectable.
    // Each office's displayed name/state uses its most recent occurrence.
    const officeMap = new Map();
    for (const qk of state.quarterKeys) {
      const q = dataset.quarters[qk];
      for (const code of Object.keys(q.offices)) {
        if (code === "TOTAL") continue;
        const o = q.offices[code];
        officeMap.set(code, { code, name: o.name.trim(), state: o.state });
      }
    }
    const offices = Array.from(officeMap.values());
    offices.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
    state.officeIndex = offices;
  }

  // ---------- Office picker ----------
  function buildOfficeSelect() {
    const select = document.getElementById("office-select");
    select.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "TOTAL";
    allOpt.textContent = "All Field Offices (National total)";
    select.appendChild(allOpt);

    let currentGroup = null;
    let currentState = null;
    for (const o of state.officeIndex) {
      if (o.state !== currentState) {
        currentState = o.state;
        currentGroup = document.createElement("optgroup");
        currentGroup.label = currentState;
        select.appendChild(currentGroup);
      }
      const opt = document.createElement("option");
      opt.value = o.code;
      opt.textContent = `${o.name} (${o.code})`;
      currentGroup.appendChild(opt);
    }

    const params = new URLSearchParams(location.search);
    const fromUrl = params.get("office");
    if (fromUrl && (fromUrl === "TOTAL" || state.officeIndex.some((o) => o.code === fromUrl))) {
      state.selectedCode = fromUrl;
    }
    select.value = state.selectedCode;

    select.addEventListener("change", () => {
      state.selectedCode = select.value;
      const url = new URL(location.href);
      url.searchParams.set("office", state.selectedCode);
      history.replaceState(null, "", url);
      renderAll();
    });

    const filterInput = document.getElementById("office-filter");
    filterInput.addEventListener("input", () => {
      const q = filterInput.value.trim().toLowerCase();
      for (const group of select.querySelectorAll("optgroup")) {
        let anyVisible = false;
        for (const opt of group.querySelectorAll("option")) {
          const match =
            !q ||
            opt.textContent.toLowerCase().includes(q) ||
            group.label.toLowerCase().includes(q);
          opt.hidden = !match;
          if (match) anyVisible = true;
        }
        group.hidden = !anyVisible;
      }
    });
  }

  function currentOfficeMeta() {
    if (state.selectedCode === "TOTAL") return "National total across all 93 field offices.";
    const o = state.officeIndex.find((x) => x.code === state.selectedCode);
    return o ? `${o.name.trim()}, ${o.state} — office code ${o.code}` : "";
  }

  // ---------- Derived series ----------
  function officeRecord(quarterKey) {
    const q = state.dataset.quarters[quarterKey];
    return q.offices[state.selectedCode] || null;
  }

  function quarterLabels() {
    return state.quarterKeys.map((k) => state.dataset.quarters[k].label);
  }

  function quarterLabelsForTable() {
    return state.quarterKeys.map((k) => {
      const q = state.dataset.quarters[k];
      return q.needsVerification ? `${q.label} (PDF)` : q.label;
    });
  }

  function seriesFor(field, bucket) {
    // bucket: "total" | "nat" | "mil"
    // undefined = office not present in this quarter's report at all;
    // null = office reported, but USCIS suppressed this specific value (D).
    return state.quarterKeys.map((k) => {
      const rec = officeRecord(k);
      if (!rec) return undefined;
      return rec[bucket][field];
    });
  }

  // True where the selected office has no record at all for that quarter
  // (didn't exist / wasn't in the report yet) -- distinct from a USCIS-
  // suppressed (D) value, which implies the office reported but the cell
  // was withheld for a small count.
  function officeAvailability() {
    return state.quarterKeys.map((k) => officeRecord(k) !== null);
  }

  function suppressedFor(field, bucket) {
    return state.quarterKeys.map((k) => {
      const rec = officeRecord(k);
      if (!rec) return false;
      return rec.suppressed[bucket][field];
    });
  }

  function rateSeries() {
    const approved = seriesFor("approved", "nat");
    const denied = seriesFor("denied", "nat");
    const availability = officeAvailability();
    const approvalRate = [];
    const denialRate = [];
    for (let i = 0; i < approved.length; i++) {
      const a = approved[i];
      const d = denied[i];
      if (a == null || d == null || a + d === 0) {
        // undefined = office not in this quarter's report; null = reported
        // but this specific rate can't be computed (a suppressed value, or
        // zero decided cases).
        const gap = availability[i] ? null : undefined;
        approvalRate.push(gap);
        denialRate.push(gap);
      } else {
        approvalRate.push((a / (a + d)) * 100);
        denialRate.push((d / (a + d)) * 100);
      }
    }
    return { approvalRate, denialRate };
  }

  // Completions (approved + denied) ÷ received, Total bucket. Below 1 means
  // the office completed fewer cases than it received that quarter.
  function efficiencySeries() {
    const received = seriesFor("received", "total");
    const approved = seriesFor("approved", "total");
    const denied = seriesFor("denied", "total");
    const availability = officeAvailability();
    return state.quarterKeys.map((_k, i) => {
      const r = received[i];
      const a = approved[i];
      const d = denied[i];
      if (r == null || a == null || d == null || r === 0) {
        return availability[i] ? null : undefined;
      }
      return (a + d) / r;
    });
  }

  // Pending ÷ completions (approved + denied) × 3 months, Total bucket -- a
  // rough "quarters of backlog, in months" capacity gauge.
  function backlogMonthsSeries() {
    const pending = seriesFor("pending", "total");
    const approved = seriesFor("approved", "total");
    const denied = seriesFor("denied", "total");
    const availability = officeAvailability();
    return state.quarterKeys.map((_k, i) => {
      const p = pending[i];
      const a = approved[i];
      const d = denied[i];
      if (p == null || a == null || d == null || a + d === 0) {
        return availability[i] ? null : undefined;
      }
      return (p / (a + d)) * 3;
    });
  }

  // ---------- Stat tiles ----------
  function renderStats() {
    const row = document.getElementById("stat-row");
    row.innerHTML = "";
    const lastKey = state.quarterKeys[state.quarterKeys.length - 1];
    const prevKey = state.quarterKeys[state.quarterKeys.length - 2];
    const last = officeRecord(lastKey);
    const prev = prevKey ? officeRecord(prevKey) : null;

    const tiles = [
      { label: "Applications received", field: "received", sentiment: "neutral" },
      { label: "Approved", field: "approved", sentiment: "good" },
      { label: "Denied", field: "denied", sentiment: "bad" },
      { label: "Pending (end of quarter)", field: "pending", sentiment: "neutral" },
    ];

    for (const t of tiles) {
      const val = last ? last.total[t.field] : null;
      const prevVal = prev ? prev.total[t.field] : null;
      const div = document.createElement("div");
      div.className = "stat-tile";

      const label = document.createElement("div");
      label.className = "stat-label";
      label.textContent = `${t.label} — ${state.dataset.quarters[lastKey].label}`;
      div.appendChild(label);

      const value = document.createElement("div");
      value.className = "stat-value";
      value.textContent = val === null ? "—" : fmtInt.format(val);
      div.appendChild(value);

      const delta = document.createElement("div");
      delta.className = "stat-delta";
      if (val !== null && prevVal !== null && prevVal !== 0) {
        const pct = ((val - prevVal) / prevVal) * 100;
        const sign = pct > 0 ? "+" : "";
        delta.textContent = `${sign}${pct.toFixed(1)}% vs ${state.dataset.quarters[prevKey].label}`;
        if (t.sentiment !== "neutral") {
          const goodDirection = t.sentiment === "good" ? pct > 0 : pct < 0;
          delta.classList.add(goodDirection ? "up-good" : "up-bad");
        }
      } else {
        delta.textContent = "no prior quarter to compare";
      }
      div.appendChild(delta);

      row.appendChild(div);
    }
  }

  // ---------- Legends ----------
  function renderLegend(elId, items) {
    const el = document.getElementById(elId);
    el.innerHTML = "";
    for (const it of items) {
      const span = document.createElement("span");
      span.className = "legend-item";
      const swatch = document.createElement("span");
      swatch.className = it.shape === "line" ? "legend-line" : "legend-swatch";
      swatch.style.background = it.color;
      const label = document.createElement("span");
      label.textContent = it.label;
      span.appendChild(swatch);
      span.appendChild(label);
      el.appendChild(span);
    }
  }

  // ---------- Chart.js shared config ----------
  function baseScales(yTitle) {
    return {
      x: {
        grid: { display: false },
        ticks: { color: cssVar("--text-muted"), font: { size: 11 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: cssVar("--gridline") },
        border: { color: cssVar("--baseline") },
        ticks: {
          color: cssVar("--text-muted"),
          font: { size: 11 },
          callback: (v) => fmtInt.format(v),
        },
        title: { display: !!yTitle, text: yTitle, color: cssVar("--text-muted"), font: { size: 11 } },
      },
    };
  }

  function tooltipBase(valueFormatter, availability) {
    return {
      mode: "index",
      intersect: false,
      backgroundColor: cssVar("--surface-1"),
      titleColor: cssVar("--text-primary"),
      bodyColor: cssVar("--text-primary"),
      borderColor: cssVar("--border"),
      borderWidth: 1,
      padding: 10,
      boxPadding: 4,
      titleFont: { size: 12, weight: "600" },
      bodyFont: { size: 12 },
      callbacks: {
        label: (ctx) => {
          const v = ctx.parsed.y;
          let shown;
          if (v === null || v === undefined) {
            const available = availability ? availability[ctx.dataIndex] : true;
            shown = available ? "suppressed (D)" : "not in report";
          } else {
            shown = valueFormatter(v);
          }
          return `${shown}  ${ctx.dataset.label}`;
        },
      },
    };
  }

  function destroyChart(key) {
    if (state.charts[key]) {
      state.charts[key].destroy();
      delete state.charts[key];
    }
  }

  // With up to 47+ quarters on screen, dense point markers and rotated
  // labels get noisy fast -- points only appear on hover, and the x-axis
  // auto-skips labels to whatever fits.
  function lineDataset(label, data, color, opts) {
    return Object.assign(
      {
        label,
        data,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        tension: 0.15,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHitRadius: 8,
        pointBackgroundColor: color,
        pointBorderColor: cssVar("--surface-1"),
        pointBorderWidth: 2,
        spanGaps: false,
      },
      opts || {}
    );
  }

  // A tick + short "Qn" label for every quarter that fits. autoSkip is
  // width-aware and re-runs on resize, so a wide desktop chart shows every
  // one of the 47 quarters while a narrow phone screen thins gracefully
  // instead of rotating into an unreadable pile. A second row of "FYxxxx"
  // labels grouping them is drawn by yearBandsPlugin in the space reserved
  // by quarterXScale()'s afterFit.
  function quarterXTicks() {
    return {
      autoSkip: true,
      autoSkipPadding: 6,
      maxRotation: 0,
      minRotation: 0,
      color: cssVar("--text-muted"),
      font: { size: 10 },
      callback: (_value, index) => {
        const k = state.quarterKeys[index];
        const q = k ? state.dataset.quarters[k] : null;
        return q ? `Q${q.quarter}` : "";
      },
    };
  }

  function quarterXScale() {
    return {
      grid: { display: false },
      ticks: quarterXTicks(),
      afterFit: (scale) => {
        scale.height += 16;
      },
    };
  }

  // ---------- Flow chart ----------
  function renderFlowChart() {
    const labels = quarterLabels();
    const received = seriesFor("received", "total");
    const approved = seriesFor("approved", "total");
    const denied = seriesFor("denied", "total");
    const availability = officeAvailability();

    renderLegend("flow-legend", [
      { label: "Applications received", color: cssVar("--series-received"), shape: "line" },
      { label: "Approved", color: cssVar("--series-approved"), shape: "line" },
      { label: "Denied", color: cssVar("--series-denied"), shape: "line" },
    ]);

    destroyChart("flow");
    const ctx = document.getElementById("flow-chart").getContext("2d");
    state.charts.flow = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Received", received, cssVar("--series-received")),
          lineDataset("Approved", approved, cssVar("--series-approved")),
          lineDataset("Denied", denied, cssVar("--series-denied")),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipBase((v) => fmtInt.format(v), availability),
          yearBands: yearBandsOptions(),
        },
        scales: {
          x: quarterXScale(),
          y: baseScales().y,
        },
      },
    });

    const flowTableLabels = quarterLabelsForTable();
    renderTable("flow-table-wrap", {
      caption: "Applications received, approved, denied by quarter (Total)",
      columns: ["Quarter", "Received", "Approved", "Denied"],
      rows: state.quarterKeys.map((k, i) => [
        flowTableLabels[i],
        received[i],
        approved[i],
        denied[i],
      ]),
    });
  }

  // ---------- Pending chart ----------
  function renderPendingChart() {
    const labels = quarterLabels();
    const pending = seriesFor("pending", "total");
    const availability = officeAvailability();

    destroyChart("pending");
    const ctx = document.getElementById("pending-chart").getContext("2d");
    state.charts.pending = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Pending", pending, cssVar("--series-pending"), {
            backgroundColor: hexToRgba(cssVar("--series-pending"), 0.1),
            fill: true,
          }),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipBase((v) => fmtInt.format(v), availability),
          yearBands: yearBandsOptions(),
        },
        scales: {
          x: quarterXScale(),
          y: baseScales().y,
        },
      },
    });

    const pendingTableLabels = quarterLabelsForTable();
    renderTable("pending-table-wrap", {
      caption: "Pending cases at quarter end (Total)",
      columns: ["Quarter", "Pending"],
      rows: state.quarterKeys.map((k, i) => [pendingTableLabels[i], pending[i]]),
    });
  }

  // ---------- Rate chart ----------
  function renderRateChart() {
    const labels = quarterLabels();
    const { approvalRate, denialRate } = rateSeries();
    const availability = officeAvailability();

    renderLegend("rate-legend", [
      { label: "Approval rate", color: cssVar("--series-approval-rate"), shape: "line" },
      { label: "Denial rate", color: cssVar("--series-denial-rate"), shape: "line" },
    ]);

    destroyChart("rate");
    const ctx = document.getElementById("rate-chart").getContext("2d");
    state.charts.rate = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Approval rate", approvalRate, cssVar("--series-approval-rate")),
          lineDataset("Denial rate", denialRate, cssVar("--series-denial-rate")),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipBase((v) => `${v.toFixed(1)}%`, availability),
          yearBands: yearBandsOptions(),
        },
        scales: {
          x: quarterXScale(),
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: cssVar("--gridline") },
            border: { color: cssVar("--baseline") },
            ticks: {
              color: cssVar("--text-muted"),
              font: { size: 11 },
              callback: (v) => `${v}%`,
            },
          },
        },
      },
    });

    const rateTableLabels = quarterLabelsForTable();
    renderTable("rate-table-wrap", {
      caption: "Approval / denial rate, non-military Naturalization category",
      columns: ["Quarter", "Approval rate", "Denial rate"],
      rows: state.quarterKeys.map((k, i) => [
        rateTableLabels[i],
        approvalRate[i] == null ? approvalRate[i] : `${approvalRate[i].toFixed(1)}%`,
        denialRate[i] == null ? denialRate[i] : `${denialRate[i].toFixed(1)}%`,
      ]),
    });
  }

  // ---------- Efficiency chart ----------
  function renderEfficiencyChart() {
    const labels = quarterLabels();
    const efficiency = efficiencySeries();
    const availability = officeAvailability();
    const reference = labels.map(() => 1);

    destroyChart("efficiency");
    const ctx = document.getElementById("efficiency-chart").getContext("2d");
    state.charts.efficiency = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Efficiency", efficiency, cssVar("--series-efficiency")),
          lineDataset("Reference", reference, cssVar("--reference-line"), {
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            pointHoverRadius: 0,
            pointHitRadius: 0,
          }),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign(tooltipBase((v) => v.toFixed(2), availability), {
            filter: (item) => item.dataset.label !== "Reference",
          }),
          yearBands: yearBandsOptions(),
        },
        scales: {
          x: quarterXScale(),
          y: {
            beginAtZero: true,
            grid: { color: cssVar("--gridline") },
            border: { color: cssVar("--baseline") },
            ticks: { color: cssVar("--text-muted"), font: { size: 11 }, callback: (v) => v.toFixed(1) },
          },
        },
      },
    });

    const efficiencyTableLabels = quarterLabelsForTable();
    renderTable("efficiency-table-wrap", {
      caption: "Efficiency (completions ÷ received, Total)",
      columns: ["Quarter", "Efficiency"],
      rows: state.quarterKeys.map((k, i) => [
        efficiencyTableLabels[i],
        efficiency[i] == null ? efficiency[i] : efficiency[i].toFixed(2),
      ]),
    });
  }

  // ---------- Backlog clearance time chart ----------
  function renderBacklogChart() {
    const labels = quarterLabels();
    const backlog = backlogMonthsSeries();
    const availability = officeAvailability();

    destroyChart("backlog");
    const ctx = document.getElementById("backlog-chart").getContext("2d");
    state.charts.backlog = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [lineDataset("Backlog clearance time", backlog, cssVar("--series-backlog"))],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipBase((v) => `${v.toFixed(1)} mo`, availability),
          yearBands: yearBandsOptions(),
        },
        scales: {
          x: quarterXScale(),
          y: {
            beginAtZero: true,
            grid: { color: cssVar("--gridline") },
            border: { color: cssVar("--baseline") },
            ticks: { color: cssVar("--text-muted"), font: { size: 11 }, callback: (v) => v.toFixed(0) },
          },
        },
      },
    });

    const backlogTableLabels = quarterLabelsForTable();
    renderTable("backlog-table-wrap", {
      caption: "Backlog clearance time in months (pending ÷ completions × 3, Total)",
      columns: ["Quarter", "Backlog clearance (months)"],
      rows: state.quarterKeys.map((k, i) => [
        backlogTableLabels[i],
        backlog[i] == null ? backlog[i] : backlog[i].toFixed(1),
      ]),
    });
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ---------- Table view ----------
  function renderTable(containerId, { columns, rows }) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    const table = document.createElement("table");
    table.className = "data-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of columns) {
      const th = document.createElement("th");
      th.textContent = col;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      row.forEach((cell, i) => {
        const td = document.createElement("td");
        if (cell === null) {
          td.textContent = "D (suppressed)";
          td.className = "suppressed-cell";
        } else if (cell === undefined) {
          td.textContent = "not in report";
          td.className = "suppressed-cell";
        } else if (typeof cell === "number") {
          td.textContent = fmtInt.format(cell);
        } else {
          td.textContent = cell;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function initTableToggles() {
    document.querySelectorAll(".table-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.dataset.target);
        const hidden = target.hasAttribute("hidden");
        if (hidden) {
          target.removeAttribute("hidden");
          btn.textContent = "Hide table";
        } else {
          target.setAttribute("hidden", "");
          btn.textContent = "View as table";
        }
      });
    });
  }

  function renderPdfQualityNote() {
    const el = document.getElementById("pdf-quality-note");
    const pdfQuarters = state.quarterKeys.filter((k) => {
      const q = state.dataset.quarters[k];
      return q.needsVerification && q.offices[state.selectedCode];
    });
    if (pdfQuarters.length === 0) {
      el.hidden = true;
      return;
    }
    const labels = pdfQuarters.map((k) => state.dataset.quarters[k].label);
    el.hidden = false;
    el.textContent =
      `⚠ ${labels.length} quarter${labels.length === 1 ? "" : "s"} shown here (${labels.join(", ")}) ` +
      `were extracted from USCIS PDF reports rather than spreadsheets and haven't been independently ` +
      `verified against the source. Numbers could be misread during extraction — spot-check against the ` +
      `original PDF before relying on them.`;
  }

  // ---------- Render orchestration ----------
  function renderAll() {
    document.getElementById("office-meta").textContent = currentOfficeMeta();
    renderPdfQualityNote();
    renderStats();
    renderFlowChart();
    renderPendingChart();
    renderRateChart();
    renderEfficiencyChart();
    renderBacklogChart();
  }

  async function main() {
    initTheme();
    await loadData();
    buildOfficeSelect();
    initTableToggles();
    renderAll();
  }

  main();
})();
