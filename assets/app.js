(function () {
  "use strict";

  const fmtInt = new Intl.NumberFormat("en-US");
  const fmtPct = (v) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);
  // Signed percentage-point formatter that rounds before checking the sign,
  // so a value like -0.04 (which rounds to "0.0") doesn't display as "-0.0".
  const fmtPp = (v) => {
    const r = Math.round(v * 10) / 10;
    return `${r > 0 ? "+" : ""}${r === 0 ? "0.0" : r.toFixed(1)} pp`;
  };

  // Both forms share this report family's shape (a TOTAL row, offices grouped
  // by state, several category blocks each with received/approved/denied/
  // pending) but differ in which bucket is reliable enough to compute an
  // approval/denial rate from directly -- N-400's "Total" mixes in a Military
  // Naturalization category with heavy small-count suppression, so its rate
  // chart uses the cleaner non-military "nat" bucket instead; I-485 has no
  // such suppression in any bucket, so "total" is fine there.
  const FORMS = {
    n400: {
      key: "n400",
      label: "N-400 (Naturalization)",
      dataUrl: "data/n400_quarterly.json",
      pageTitle: "USCIS N-400 Field Office Dashboard",
      pageDescription:
        "Quarterly N-400 naturalization application, approval, denial, and pending trends by USCIS field office.",
      h1: "USCIS N-400 Field Office Dashboard",
      subtitle:
        "Quarterly Form N-400 (Application for Naturalization) volumes by USCIS field office: applications received, approved, denied, and pending at quarter end.",
      officeFilterLabel: "Search field offices",
      rateBucket: "nat",
      rateBucketLabel: "non-military Naturalization category",
      flowChartNote:
        "Received, approved, and denied counts for the quarter (Naturalization + Military Naturalization combined). These are flow counts — each point covers only that quarter's activity, not a running total.",
      rateChartNote:
        "Share of decided cases (approved + denied) that quarter, computed from the non-military Naturalization category only. Military naturalization is excluded here because ~15% of its office-level cells are suppressed by USCIS for small counts, which would make a rate computed from it unreliable at the office level.",
      footerSource:
        "Source: U.S. Department of Homeland Security, USCIS quarterly Form N-400 performance reports by field office, FY2015 Q1 through FY2026 Q3 (47 quarters). USCIS has changed this report's format several times over that span — spreadsheets (FY2015–2018, FY2022–2026) and PDFs (FY2019–2021) — see the data-quality note above the charts for PDF-derived quarters. “D” indicates a value suppressed by USCIS disclosure standards for small counts; suppressed cells are shown as gaps, not zero. The set of field offices has also changed over time as offices opened, closed, or were renamed; an office is selectable here if it appears in any quarter, and its chart will show gaps for quarters before it opened or after it closed.",
      showFy2026Q3Note: true,
    },
    i485: {
      key: "i485",
      label: "I-485 (Adjustment of Status)",
      dataUrl: "data/i485_quarterly.json",
      pageTitle: "USCIS I-485 Field Office Dashboard",
      pageDescription:
        "Quarterly I-485 adjustment-of-status application, approval, denial, and pending trends by USCIS field office and service center.",
      h1: "USCIS I-485 Field Office Dashboard",
      subtitle:
        "Quarterly Form I-485 (Application to Register Permanent Residence or Adjust Status) volumes by USCIS field office and service center: applications received, approved, denied, and pending at quarter end, across Family-based, Employment-based, Humanitarian-based, and Other categories.",
      officeFilterLabel: "Search offices and service centers",
      rateBucket: "total",
      rateBucketLabel: "Total category (all four admission categories combined)",
      flowChartNote:
        "Received, approved, and denied counts for the quarter, summed across all four admission categories (Family-based, Employment-based, Humanitarian-based, Other) unless a single category is selected above. These are flow counts — each point covers only that quarter's activity, not a running total.",
      rateChartNote:
        "Share of decided cases (approved + denied) that quarter that ended in denial, computed from the Total category (all four admission categories combined) unless a single category is selected above. Unlike N-400, no I-485 category shows meaningful small-count suppression, so Total is used directly rather than excluding a category.",
      footerSource:
        "Source: U.S. Department of Homeland Security, USCIS quarterly Form I-485 performance reports by field office and service center, FY2015 Q1 through FY2026 Q3 (47 quarters). Some quarters are PDF-derived (FY2015 Q1, FY2019–2021) — see the data-quality note above the charts for those. “D” indicates a value suppressed by USCIS disclosure standards for small counts; suppressed cells are shown as gaps, not zero. An office is selectable here if it appears in any quarter, and its chart will show gaps for quarters before it opened or after it closed.",
      showFy2026Q3Note: false,
      // Category blocks this form's report breaks applications into, besides
      // Total -- lets the dashboard offer a per-category view. N-400 has no
      // entry here (Military Naturalization is a data-quality carve-out, not
      // a category worth viewing standalone), so its toggle stays hidden.
      categories: ["family", "employment", "humanitarian", "other"],
      categoryLabels: {
        total: "All categories",
        family: "Family-based",
        employment: "Employment-based",
        humanitarian: "Humanitarian-based",
        other: "Other",
      },
    },
  };

  const state = {
    formKey: "n400",
    categoryKey: "total", // "total" | one of formConfig().categories -- I-485 only
    denialChangeLag: 1, // 1 (prior quarter) or 4 (four quarters ago)
    yearMode: "fy", // "fy" (fiscal year, default) or "cy" (calendar year) -- x-axis labels
    dataset: null,
    quarterKeys: [],
    officeIndex: [], // [{code, name, state}]
    selectedCode: "TOTAL",
    charts: {},
  };

  function formConfig() {
    return FORMS[state.formKey];
  }

  // The bucket every chart/stat/outlier reads its received/approved/denied/
  // pending from. Defaults to "total"; picking a category in the toggle
  // (I-485 only) switches every one of them to that category instead of
  // filtering a Total-based view.
  function activeBucket() {
    return state.categoryKey;
  }

  // The bucket specifically for the approval/denial-rate chart and the
  // outlier panel's denial-rate metric. At "total" this defers to the form's
  // own rateBucket (N-400 excludes its suppressed Military category there;
  // I-485 has no such need); once a specific category is picked, the rate is
  // naturally computed from that same category.
  function activeRateBucket() {
    return state.categoryKey === "total" ? formConfig().rateBucket : state.categoryKey;
  }

  function categoryLabel(bucket) {
    const labels = formConfig().categoryLabels;
    if (labels && labels[bucket]) return labels[bucket];
    return bucket === "total" ? "Total" : bucket;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---------- Year-axis bands ----------
  // Draws alternating background shading behind each year's quarters, plus a
  // centered "FYxxxx"/"CYxxxx" label in a reserved strip below the Q1-Q4 tick
  // labels. Registered once globally; each chart opts in by setting
  // options.plugins.yearBands.years (state.yearMode picks fiscal vs.
  // calendar year grouping -- see axisYearsArray()).
  // Draws a colored strip behind the Q1-Q4 tick-label row (between
  // chartArea.bottom and the reserved FY-label strip) indicating which
  // party held the presidency as of that quarter's period end. Grouped into
  // runs of consecutive same-party quarters, same approach as the FY bands
  // above -- doesn't overlap them since the FY bands only cover the plot
  // area (chartArea.top..chartArea.bottom), not the tick-label row below it.
  function drawPartyStrip(chart, opts) {
    const parties = opts.parties;
    if (!parties || !parties.length) return;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    if (!chartArea) return;
    const n = parties.length;
    const step = n > 1 ? xScale.getPixelForValue(1) - xScale.getPixelForValue(0) : chartArea.width;
    const labelBandHeight = opts.labelBandHeight || 16;
    const top = chartArea.bottom;
    const bottom = xScale.bottom - labelBandHeight;
    if (bottom <= top) return;
    ctx.save();
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && parties[j + 1] === parties[i]) j++;
      const color = opts.partyColors && opts.partyColors[parties[i]];
      if (color) {
        const left = xScale.getPixelForValue(i) - step / 2;
        const right = xScale.getPixelForValue(j) + step / 2;
        ctx.fillStyle = color;
        ctx.fillRect(left, top, right - left, bottom - top);
      }
      i = j + 1;
    }
    ctx.restore();
  }

  const yearBandsPlugin = {
    id: "yearBands",
    beforeDraw(chart, _args, opts) {
      drawPartyStrip(chart, opts);
      const years = opts.years;
      if (!years || !years.length) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      if (!chartArea) return;
      const n = years.length;
      const step = n > 1 ? xScale.getPixelForValue(1) - xScale.getPixelForValue(0) : chartArea.width;
      ctx.save();
      let i = 0;
      let bandIndex = 0;
      while (i < n) {
        let j = i;
        while (j + 1 < n && years[j + 1] === years[i]) j++;
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
      const years = opts.years;
      if (!years || !years.length) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      if (!chartArea) return;
      const n = years.length;
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
        while (j + 1 < n && years[j + 1] === years[i]) j++;
        const cx = (xScale.getPixelForValue(i) + xScale.getPixelForValue(j)) / 2;
        const text = `${opts.yearPrefix || "FY"}${years[i]}`;
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

  // Calendar year/quarter for a quarter's periodEnd -- USCIS's fiscal
  // quarters run Oct-Sep, so periodEnd's own month/year gives the calendar
  // quarter directly (e.g. FY2015 Q1 ends 2014-12-31 -> CY2014 Q4).
  function calendarYearOf(periodEnd) {
    return Number(periodEnd.slice(0, 4));
  }
  function calendarQuarterOf(periodEnd) {
    return Math.ceil(Number(periodEnd.slice(5, 7)) / 3);
  }

  function axisYearsArray() {
    return state.quarterKeys.map((k) => {
      const q = state.dataset.quarters[k];
      return state.yearMode === "cy" ? calendarYearOf(q.periodEnd) : q.fy;
    });
  }

  // Presidential party in office as of each quarter's period end. Using
  // periodEnd (rather than fiscal year/quarter number) naturally implements
  // "Q2 of the inauguration FY counts as the incoming president" with no
  // special-casing: Q2 always ends March 31, after the January 20
  // inauguration, while Q1 always ends December 31, before it.
  const ADMINISTRATIONS = [
    { start: "2009-01-20", party: "D" }, // Obama
    { start: "2017-01-20", party: "R" }, // Trump
    { start: "2021-01-20", party: "D" }, // Biden
    { start: "2025-01-20", party: "R" }, // Trump
  ];

  function partyForPeriodEnd(periodEnd) {
    let party = null;
    for (const admin of ADMINISTRATIONS) {
      if (periodEnd >= admin.start) party = admin.party;
    }
    return party;
  }

  function partiesArray() {
    return state.quarterKeys.map((k) => partyForPeriodEnd(state.dataset.quarters[k].periodEnd));
  }

  function yearBandsOptions() {
    return {
      years: axisYearsArray(),
      yearPrefix: state.yearMode === "cy" ? "CY" : "FY",
      bandColor: cssVar("--year-band"),
      labelColor: cssVar("--text-muted"),
      parties: partiesArray(),
      partyColors: { D: cssVar("--party-d"), R: cssVar("--party-r") },
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
    const res = await fetch(formConfig().dataUrl);
    const dataset = await res.json();
    state.dataset = dataset;
    state.quarterKeys = Object.keys(dataset.quarters); // already chronological from ingest script

    // Union offices across every quarter (not just the latest) so offices that
    // closed or were renamed earlier in the dataset's span stay selectable.
    // Each office's displayed name/state uses its most recent occurrence.
    const officeMap = new Map();
    let totalLabel = "All Offices (National total)";
    for (const qk of state.quarterKeys) {
      const q = dataset.quarters[qk];
      for (const code of Object.keys(q.offices)) {
        const o = q.offices[code];
        if (code === "TOTAL") {
          totalLabel = o.name.trim();
          continue;
        }
        officeMap.set(code, { code, name: o.name.trim(), state: o.state });
      }
    }
    const offices = Array.from(officeMap.values());
    offices.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
    state.officeIndex = offices;
    state.totalLabel = totalLabel;
  }

  // ---------- Office picker ----------
  // Rebuilds the <option> list -- called on load and every form switch, since
  // the two forms' office sets differ (I-485 includes service centers N-400
  // doesn't have at all). Listener setup is separate (initOfficeSelectListeners,
  // called once) so switching forms repeatedly doesn't stack duplicate handlers.
  function populateOfficeOptions() {
    const select = document.getElementById("office-select");
    select.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "TOTAL";
    allOpt.textContent = state.totalLabel || "All Offices (National total)";
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
    const validCodes = new Set(["TOTAL", ...state.officeIndex.map((o) => o.code)]);
    if (fromUrl && validCodes.has(fromUrl)) {
      state.selectedCode = fromUrl;
    } else if (!validCodes.has(state.selectedCode)) {
      // Switched form and the previously selected code doesn't exist here
      // (e.g. an I-485 service center has no N-400 equivalent).
      state.selectedCode = "TOTAL";
    }
    select.value = state.selectedCode;

    const filterInput = document.getElementById("office-filter");
    filterInput.value = "";
    for (const opt of select.querySelectorAll("option, optgroup")) {
      opt.hidden = false;
    }
  }

  function initOfficeSelectListeners() {
    const select = document.getElementById("office-select");
    select.addEventListener("change", () => {
      state.selectedCode = select.value;
      syncUrl();
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

  function syncUrl() {
    const url = new URL(location.href);
    url.searchParams.set("form", state.formKey);
    url.searchParams.set("office", state.selectedCode);
    if (state.categoryKey === "total") {
      url.searchParams.delete("category");
    } else {
      url.searchParams.set("category", state.categoryKey);
    }
    if (state.denialChangeLag === 1) {
      url.searchParams.delete("denialChangeLag");
    } else {
      url.searchParams.set("denialChangeLag", state.denialChangeLag);
    }
    if (state.yearMode === "fy") {
      url.searchParams.delete("yearMode");
    } else {
      url.searchParams.set("yearMode", state.yearMode);
    }
    history.replaceState(null, "", url);
  }

  function currentOfficeMeta() {
    if (state.selectedCode === "TOTAL") {
      return `National total across all ${state.officeIndex.length} offices.`;
    }
    const o = state.officeIndex.find((x) => x.code === state.selectedCode);
    return o ? `${o.name.trim()}, ${o.state} — office code ${o.code}` : "";
  }

  // ---------- Derived series ----------
  function officeRecord(quarterKey) {
    const q = state.dataset.quarters[quarterKey];
    return q.offices[state.selectedCode] || null;
  }

  // Quarter label for chart tooltips and table rows -- kept in sync with
  // state.yearMode so it always matches what the x-axis itself is showing
  // (a tooltip reading "FY2015 Q1" while the axis reads "CY2014 Q4" would
  // look like a bug, not a deliberate choice).
  function axisLabelFor(q) {
    if (state.yearMode === "cy") {
      return `CY${calendarYearOf(q.periodEnd)} Q${calendarQuarterOf(q.periodEnd)}`;
    }
    return q.label;
  }

  function quarterLabels() {
    return state.quarterKeys.map((k) => axisLabelFor(state.dataset.quarters[k]));
  }

  function quarterLabelsForTable() {
    return state.quarterKeys.map((k) => {
      const q = state.dataset.quarters[k];
      const label = axisLabelFor(q);
      return q.needsVerification ? `${label} (PDF)` : label;
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
    const bucket = activeRateBucket();
    const approved = seriesFor("approved", bucket);
    const denied = seriesFor("denied", bucket);
    const availability = officeAvailability();
    const denialRate = [];
    for (let i = 0; i < approved.length; i++) {
      const a = approved[i];
      const d = denied[i];
      if (a == null || d == null || a + d === 0) {
        // undefined = office not in this quarter's report; null = reported
        // but this specific rate can't be computed (a suppressed value, or
        // zero decided cases).
        denialRate.push(availability[i] ? null : undefined);
      } else {
        denialRate.push((d / (a + d)) * 100);
      }
    }
    return { denialRate };
  }

  // Percentage-point change in denial rate vs. `lag` quarters earlier
  // (same rateSeries() denial rate every other chart uses, so this always
  // matches the active form/category). undefined = one side of the
  // comparison has no office record at all (including simply not enough
  // history yet, e.g. lag=4 in the dataset's first year); null = both
  // quarters have a record but the rate itself couldn't be computed
  // (suppressed, or zero decided cases).
  function denialRateChangeSeries(lag) {
    const { denialRate } = rateSeries();
    const availability = officeAvailability();
    return state.quarterKeys.map((_k, i) => {
      const j = i - lag;
      if (j < 0 || !availability[i] || !availability[j]) return undefined;
      const cur = denialRate[i];
      const prior = denialRate[j];
      if (cur == null || prior == null) return null;
      return cur - prior;
    });
  }

  // Completions (approved + denied) ÷ received, active bucket. Below 1 means
  // the office completed fewer cases than it received that quarter.
  function efficiencySeries() {
    const bucket = activeBucket();
    const received = seriesFor("received", bucket);
    const approved = seriesFor("approved", bucket);
    const denied = seriesFor("denied", bucket);
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

  // Pending ÷ completions (approved + denied) × 3 months, active bucket -- a
  // rough "quarters of backlog, in months" capacity gauge.
  function backlogMonthsSeries() {
    const bucket = activeBucket();
    const pending = seriesFor("pending", bucket);
    const approved = seriesFor("approved", bucket);
    const denied = seriesFor("denied", bucket);
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

  // ---------- Outlier analysis ----------
  // Independent of the office picker: scans every office for the most
  // recent quarter and flags whichever ones sit statistically far from
  // their peers on a few metrics. A minimum-volume floor per metric keeps
  // small offices' noisy ratios (e.g. one denial out of five decided cases)
  // from crowding out genuine disparities at busier offices.
  function meanStd(values) {
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
    return { mean, std: Math.sqrt(variance) };
  }

  function zOutliers(rows, valueKey, volumeKey, minVolume, threshold) {
    const candidates = rows.filter(
      (r) => r[valueKey] != null && r[volumeKey] != null && r[volumeKey] >= minVolume
    );
    if (candidates.length < 5) return { outliers: [], mean: 0, std: 0 };
    const { mean, std } = meanStd(candidates.map((r) => r[valueKey]));
    if (std === 0) return { outliers: [], mean, std };
    const outliers = candidates
      .map((r) => ({ row: r, z: (r[valueKey] - mean) / std }))
      .filter((o) => Math.abs(o.z) >= threshold)
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    return { outliers, mean, std };
  }

  function computeOfficeMetricsForQuarter(quarterKey, prevQuarterKey) {
    const bucket = activeBucket();
    const rateBucket = activeRateBucket();
    const q = state.dataset.quarters[quarterKey];
    const prevQ = prevQuarterKey ? state.dataset.quarters[prevQuarterKey] : null;
    const rows = [];
    for (const code of Object.keys(q.offices)) {
      if (code === "TOTAL") continue;
      const o = q.offices[code];
      const { received: r, approved: a, denied: d, pending: p } = o[bucket];
      const { approved: ra, denied: rd } = o[rateBucket];
      if (r == null || a == null || d == null || p == null) continue;
      const decided = a + d;
      const efficiency = r > 0 ? decided / r : null;
      const backlogMonths = decided > 0 ? (p / decided) * 3 : null;
      const rateDecided = (ra || 0) + (rd || 0);
      const denialRate = ra != null && rd != null && rateDecided > 0 ? (rd / rateDecided) * 100 : null;
      let qoqReceived = null;
      const prevO = prevQ ? prevQ.offices[code] : null;
      if (prevO && prevO[bucket].received) {
        qoqReceived = ((r - prevO[bucket].received) / prevO[bucket].received) * 100;
      }
      rows.push({
        code,
        name: o.name.trim(),
        state: o.state,
        received: r,
        decided,
        pending: p,
        efficiency,
        backlogMonths,
        denialRate,
        qoqReceived,
      });
    }
    return rows;
  }

  function computeOutliers() {
    const latestKey = state.quarterKeys[state.quarterKeys.length - 1];
    const prevKey = state.quarterKeys[state.quarterKeys.length - 2];
    const rows = computeOfficeMetricsForQuarter(latestKey, prevKey);

    const MIN_DECIDED = 100;
    const MIN_RECEIVED = 100;
    const Z_THRESHOLD = 1.3;
    const flagsByOffice = new Map();

    function addFlag(row, sentiment, text, z) {
      if (!flagsByOffice.has(row.code)) {
        flagsByOffice.set(row.code, { code: row.code, name: row.name, state: row.state, flags: [] });
      }
      flagsByOffice.get(row.code).flags.push({ sentiment, text, absZ: Math.abs(z) });
    }

    const denial = zOutliers(rows, "denialRate", "decided", MIN_DECIDED, Z_THRESHOLD);
    for (const { row, z } of denial.outliers) {
      if (z > 0) {
        addFlag(
          row,
          "concern",
          `Denial rate ${row.denialRate.toFixed(1)}% this quarter, vs a ${denial.mean.toFixed(1)}% average across offices this size (${fmtInt.format(row.decided)} decided cases).`,
          z
        );
      } else {
        addFlag(
          row,
          "positive",
          `Denial rate just ${row.denialRate.toFixed(1)}% this quarter, well below the ${denial.mean.toFixed(1)}% average (${fmtInt.format(row.decided)} decided cases).`,
          z
        );
      }
    }

    const efficiency = zOutliers(rows, "efficiency", "received", MIN_RECEIVED, Z_THRESHOLD);
    for (const { row, z } of efficiency.outliers) {
      if (z < 0) {
        addFlag(
          row,
          "concern",
          `Completed only ${Math.round(row.efficiency * 100)}% as many cases as it received this quarter (efficiency ${row.efficiency.toFixed(2)} vs a ${efficiency.mean.toFixed(2)} average) — backlog growing fast.`,
          z
        );
      } else {
        addFlag(
          row,
          "positive",
          `Completed ${Math.round(row.efficiency * 100)}% as many cases as it received this quarter (efficiency ${row.efficiency.toFixed(2)} vs a ${efficiency.mean.toFixed(2)} average) — working down its backlog.`,
          z
        );
      }
    }

    const backlog = zOutliers(rows, "backlogMonths", "decided", MIN_DECIDED, Z_THRESHOLD);
    for (const { row, z } of backlog.outliers) {
      if (z > 0) {
        addFlag(
          row,
          "concern",
          `Would take roughly ${Math.round(row.backlogMonths)} months to clear its pending backlog at this quarter's pace, vs a ${Math.round(backlog.mean)}-month average.`,
          z
        );
      }
    }

    const qoq = zOutliers(rows, "qoqReceived", "received", MIN_RECEIVED, Z_THRESHOLD);
    for (const { row, z } of qoq.outliers) {
      const dir = row.qoqReceived >= 0 ? "more" : "fewer";
      addFlag(
        row,
        "neutral",
        `Received ${row.qoqReceived >= 0 ? "+" : ""}${row.qoqReceived.toFixed(0)}% ${dir} applications than last quarter (${fmtInt.format(row.received)} this quarter) — a much bigger swing than most offices.`,
        z
      );
    }

    const offices = Array.from(flagsByOffice.values());
    for (const o of offices) {
      o.maxAbsZ = Math.max(...o.flags.map((f) => f.absZ));
      o.flags.sort((a, b) => b.absZ - a.absZ);
    }
    offices.sort((a, b) => b.flags.length - a.flags.length || b.maxAbsZ - a.maxAbsZ);

    return { latestKey, offices: offices.slice(0, 10) };
  }

  function renderOutlierPanel() {
    const { latestKey, offices } = computeOutliers();
    const quarter = state.dataset.quarters[latestKey];

    const categorySuffix = state.categoryKey === "total" ? "" : `, ${categoryLabel(state.categoryKey)} only`;
    document.getElementById("outliers-quarter-label").textContent = `— ${quarter.label}${categorySuffix}`;
    document.getElementById("outliers-note").textContent =
      `Offices whose denial rate, completion efficiency, backlog clearance time, or quarter-over-quarter ` +
      `application volume sits statistically far from their peers this quarter (at least 100 decided cases ` +
      `or applications received, to keep small offices' noisy ratios from crowding this out). Computed fresh ` +
      `from each new quarter, not a fixed list — click an office to see its full history above.`;

    const list = document.getElementById("outliers-list");
    list.innerHTML = "";

    if (offices.length === 0) {
      const p = document.createElement("p");
      p.className = "chart-note";
      p.textContent = "No offices stood out from their peers by this measure this quarter.";
      list.appendChild(p);
      return;
    }

    for (const o of offices) {
      const card = document.createElement("div");
      card.className = "outlier-office";

      const header = document.createElement("button");
      header.className = "outlier-office-header";
      header.type = "button";

      const nameSpan = document.createElement("span");
      nameSpan.className = "outlier-office-name";
      nameSpan.textContent = `${o.name} (${o.code})`;
      header.appendChild(nameSpan);

      const locSpan = document.createElement("span");
      locSpan.className = "outlier-office-loc";
      locSpan.textContent = o.state || "";
      header.appendChild(locSpan);

      header.addEventListener("click", () => {
        const select = document.getElementById("office-select");
        select.value = o.code;
        select.dispatchEvent(new Event("change"));
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      card.appendChild(header);

      const ul = document.createElement("ul");
      ul.className = "outlier-reasons";
      for (const f of o.flags) {
        const li = document.createElement("li");
        li.className = `outlier-reason ${f.sentiment}`;
        li.textContent = f.text;
        ul.appendChild(li);
      }
      card.appendChild(ul);

      list.appendChild(card);
    }
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

    const bucket = activeBucket();
    for (const t of tiles) {
      const val = last ? last[bucket][t.field] : null;
      const prevVal = prev ? prev[bucket][t.field] : null;
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
        if (!q) return "";
        return `Q${state.yearMode === "cy" ? calendarQuarterOf(q.periodEnd) : q.quarter}`;
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
    const bucket = activeBucket();
    const received = seriesFor("received", bucket);
    const approved = seriesFor("approved", bucket);
    const denied = seriesFor("denied", bucket);
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
      caption: `Applications received, approved, denied by quarter (${categoryLabel(bucket)})`,
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
    const bucket = activeBucket();
    const pending = seriesFor("pending", bucket);
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
      caption: `Pending cases at quarter end (${categoryLabel(bucket)})`,
      columns: ["Quarter", "Pending"],
      rows: state.quarterKeys.map((k, i) => [pendingTableLabels[i], pending[i]]),
    });
  }

  // ---------- Rate chart ----------
  function renderRateChart() {
    const labels = quarterLabels();
    const { denialRate } = rateSeries();
    const availability = officeAvailability();

    destroyChart("rate");
    const ctx = document.getElementById("rate-chart").getContext("2d");
    state.charts.rate = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [lineDataset("Denial rate", denialRate, cssVar("--series-denial-rate"))],
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
      caption:
        state.categoryKey === "total"
          ? `Denial rate, ${formConfig().rateBucketLabel}`
          : `Denial rate, ${categoryLabel(state.categoryKey)} category`,
      columns: ["Quarter", "Denial rate"],
      rows: state.quarterKeys.map((k, i) => [
        rateTableLabels[i],
        denialRate[i] == null ? denialRate[i] : `${denialRate[i].toFixed(1)}%`,
      ]),
    });
  }

  // ---------- Denial rate change chart ----------
  function renderDenialChangeChart() {
    const labels = quarterLabels();
    const lag = state.denialChangeLag;
    const change = denialRateChangeSeries(lag);
    const officeAvail = officeAvailability();
    const changeAvailability = state.quarterKeys.map((_k, i) => {
      const j = i - lag;
      return j >= 0 && officeAvail[i] && officeAvail[j];
    });

    for (const btn of document.querySelectorAll("#denial-change-toggle button")) {
      btn.setAttribute("aria-selected", String(Number(btn.dataset.lag) === lag));
    }

    renderLegend("denial-change-legend", [
      { label: "Denial rate increased", color: cssVar("--series-denial-rate") },
      { label: "Denial rate decreased", color: cssVar("--series-approval-rate") },
    ]);

    const upColor = cssVar("--series-denial-rate");
    const downColor = cssVar("--series-approval-rate");
    const flatColor = cssVar("--text-muted");
    const barColors = change.map((v) => (v == null ? flatColor : v > 0 ? upColor : v < 0 ? downColor : flatColor));

    destroyChart("denialChange");
    const ctx = document.getElementById("denial-change-chart").getContext("2d");
    state.charts.denialChange = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Denial rate change",
            data: change,
            backgroundColor: barColors,
            borderRadius: 4,
            maxBarThickness: 20,
            categoryPercentage: 0.7,
            barPercentage: 0.9,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipBase(fmtPp, changeAvailability),
          yearBands: yearBandsOptions(),
        },
        scales: {
          x: quarterXScale(),
          y: {
            grid: { color: cssVar("--gridline") },
            border: { color: cssVar("--baseline") },
            ticks: {
              color: cssVar("--text-muted"),
              font: { size: 11 },
              callback: (v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}pp`,
            },
          },
        },
      },
    });

    const lagLabel = lag === 1 ? "prior quarter" : `${lag} quarters ago`;
    const changeTableLabels = quarterLabelsForTable();
    renderTable("denial-change-table-wrap", {
      caption: `Denial rate change vs. ${lagLabel}`,
      columns: ["Quarter", "Change (pp)"],
      rows: state.quarterKeys.map((k, i) => [
        changeTableLabels[i],
        change[i] == null ? change[i] : fmtPp(change[i]),
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
      caption: `Efficiency (completions ÷ received, ${categoryLabel(activeBucket())})`,
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
      caption: `Backlog clearance time in months (pending ÷ completions × 3, ${categoryLabel(activeBucket())})`,
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
  function renderTable(containerId, { caption, columns, rows }) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    const table = document.createElement("table");
    table.className = "data-table";

    if (caption) {
      const captionEl = document.createElement("caption");
      captionEl.textContent = caption;
      table.appendChild(captionEl);
    }

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

  // ---------- Form-specific page text ----------
  function applyFormText() {
    const cfg = formConfig();
    document.getElementById("page-title").textContent = cfg.pageTitle;
    document.getElementById("page-description").setAttribute("content", cfg.pageDescription);
    document.getElementById("page-h1").textContent = cfg.h1;
    document.getElementById("page-subtitle").textContent = cfg.subtitle;
    document.getElementById("office-filter-label").textContent = cfg.officeFilterLabel;
    document.getElementById("flow-chart-note").textContent = cfg.flowChartNote;
    document.getElementById("rate-chart-note").textContent = cfg.rateChartNote;
    document.getElementById("footer-source").textContent = cfg.footerSource;
    document.getElementById("footer-fy2026q3-note").hidden = !cfg.showFy2026Q3Note;

    for (const btn of document.querySelectorAll("#form-toggle button")) {
      btn.setAttribute("aria-selected", String(btn.dataset.form === state.formKey));
    }

    const hasCategories = !!(cfg.categories && cfg.categories.length);
    document.getElementById("category-toggle").hidden = !hasCategories;
    for (const btn of document.querySelectorAll("#category-toggle button")) {
      btn.setAttribute("aria-selected", String(btn.dataset.category === state.categoryKey));
    }
    const note = document.getElementById("category-note");
    if (hasCategories && state.categoryKey !== "total") {
      note.hidden = false;
      note.textContent =
        `Showing ${categoryLabel(state.categoryKey)} only — every chart, stat, and the outlier panel below ` +
        `reflect this category, not just a filtered view of the combined totals. Switch back to "All ` +
        `categories" above to see all four combined.`;
    } else {
      note.hidden = true;
    }
  }

  function initFormToggle() {
    document.getElementById("form-toggle").addEventListener("click", async (ev) => {
      const btn = ev.target.closest("button[data-form]");
      if (!btn || btn.dataset.form === state.formKey) return;
      state.formKey = btn.dataset.form;
      state.selectedCode = "TOTAL"; // resolved against the new form's offices in populateOfficeOptions
      state.categoryKey = "total"; // the other form's category keys (if any) don't apply here
      applyFormText();
      await loadData();
      populateOfficeOptions();
      syncUrl();
      renderAll();
      renderOutlierPanel();
    });
  }

  function initCategoryToggle() {
    document.getElementById("category-toggle").addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-category]");
      if (!btn || btn.dataset.category === state.categoryKey) return;
      state.categoryKey = btn.dataset.category;
      applyFormText();
      syncUrl();
      renderAll();
      renderOutlierPanel();
    });
  }

  function initDenialChangeToggle() {
    document.getElementById("denial-change-toggle").addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-lag]");
      const lag = btn && Number(btn.dataset.lag);
      if (!lag || lag === state.denialChangeLag) return;
      state.denialChangeLag = lag;
      syncUrl();
      renderDenialChangeChart(); // only this chart depends on the lag choice
    });
  }

  function initYearModeToggle() {
    const el = document.getElementById("year-mode-toggle");
    for (const btn of el.querySelectorAll("button")) {
      btn.setAttribute("aria-selected", String(btn.dataset.yearMode === state.yearMode));
    }
    el.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-year-mode]");
      const mode = btn && btn.dataset.yearMode;
      if (!mode || mode === state.yearMode) return;
      state.yearMode = mode;
      for (const b of el.querySelectorAll("button")) {
        b.setAttribute("aria-selected", String(b.dataset.yearMode === state.yearMode));
      }
      syncUrl();
      renderAll(); // every chart's x-axis and table depend on this
    });
  }

  // ---------- Render orchestration ----------
  function renderAll() {
    document.getElementById("office-meta").textContent = currentOfficeMeta();
    renderPdfQualityNote();
    renderStats();
    renderFlowChart();
    renderPendingChart();
    renderRateChart();
    renderDenialChangeChart();
    renderEfficiencyChart();
    renderBacklogChart();
  }

  async function main() {
    initTheme();

    const params = new URLSearchParams(location.search);
    const formFromUrl = params.get("form");
    if (formFromUrl && FORMS[formFromUrl]) {
      state.formKey = formFromUrl;
    }
    const officeFromUrl = params.get("office");
    if (officeFromUrl) {
      state.selectedCode = officeFromUrl;
    }
    const categoryFromUrl = params.get("category");
    if (categoryFromUrl && formConfig().categories && formConfig().categories.includes(categoryFromUrl)) {
      state.categoryKey = categoryFromUrl;
    }
    const lagFromUrl = Number(params.get("denialChangeLag"));
    if (lagFromUrl === 1 || lagFromUrl === 4) {
      state.denialChangeLag = lagFromUrl;
    }
    const yearModeFromUrl = params.get("yearMode");
    if (yearModeFromUrl === "fy" || yearModeFromUrl === "cy") {
      state.yearMode = yearModeFromUrl;
    }

    applyFormText();
    initFormToggle();
    initCategoryToggle();
    initDenialChangeToggle();
    initYearModeToggle();
    await loadData();
    populateOfficeOptions();
    initOfficeSelectListeners();
    initTableToggles();
    syncUrl();
    renderAll();
    renderOutlierPanel();
  }

  main();
})();
