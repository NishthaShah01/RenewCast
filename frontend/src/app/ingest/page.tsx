"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Panel, StatusDot, Th, Td } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { mw, technologyLabel } from "@/lib/format";
import type {
  HistoryResponse,
  IngestPreviewRow,
  IngestResponse,
  IngestValidateResponse,
  Site,
  SkippedRowDetail,
} from "@/lib/types";

type FlowStep = 1 | 2 | 3 | 4;

export default function IngestPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("pavagada");
  const [siteHistory, setSiteHistory] = useState<HistoryResponse | null>(null);
  const [loadingSites, setLoadingSites] = useState<boolean>(true);

  // Flow State
  const [currentStep, setCurrentStep] = useState<FlowStep>(1);
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);

  // Column Mappings
  const [timestampCol, setTimestampCol] = useState<string>("");
  const [generationCol, setGenerationCol] = useState<string>("");

  // Validation & Import Responses
  const [validationResult, setValidationResult] = useState<IngestValidateResponse | null>(null);
  const [importResult, setImportResult] = useState<IngestResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const siteSelectId = useId();

  // Load available sites
  useEffect(() => {
    let mounted = true;
    api
      .sites()
      .then((res) => {
        if (mounted && res.sites.length > 0) {
          setSites(res.sites);
          // Default to Pavagada if available, otherwise first site
          const defaultSite = res.sites.find((s) => s.id === "pavagada") ?? res.sites[0];
          setSelectedSiteId(defaultSite.id);
        }
        setLoadingSites(false);
      })
      .catch((err) => {
        if (mounted) {
          setErrorMessage(err.message || "Failed to load sites.");
          setLoadingSites(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Fetch site history when selected site changes
  const refreshHistory = useCallback((siteId: string) => {
    api
      .history(siteId)
      .then((hist) => setSiteHistory(hist))
      .catch(() => setSiteHistory(null));
  }, []);

  useEffect(() => {
    if (selectedSiteId) {
      refreshHistory(selectedSiteId);
    }
  }, [selectedSiteId, refreshHistory]);

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId) ?? sites[0],
    [sites, selectedSiteId],
  );

  // Validate CSV with optional custom mappings
  const runValidation = useCallback(
    async (fileToValidate: File, siteId: string, tsCol?: string, genCol?: string) => {
      setIsValidating(true);
      setErrorMessage(null);

      const formData = new FormData();
      formData.append("file", fileToValidate);
      formData.append("site_id", siteId);
      if (tsCol) formData.append("timestamp_col", tsCol);
      if (genCol) formData.append("generation_col", genCol);

      try {
        const result = await api.validateCsv(formData);
        setValidationResult(result);

        // Auto-assign column mappings if detected
        const autoTs = tsCol || result.detected_mapping.timestamp || "";
        const autoGen = genCol || result.detected_mapping.generation_mw || "";
        setTimestampCol(autoTs);
        setGenerationCol(autoGen);

        if (autoTs && autoGen) {
          setCurrentStep(3); // Ready for preview
        } else {
          setCurrentStep(2); // Needs manual column mapping
        }
      } catch (err) {
        if (err instanceof ApiError) {
          setErrorMessage(`${err.message} ${err.hint ? `\nHint: ${err.hint}` : ""}`);
        } else if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage("Failed to validate CSV file. Please ensure it is valid text.");
        }
        setValidationResult(null);
      } finally {
        setIsValidating(false);
      }
    },
    [],
  );

  // File selection handler
  const handleFileSelect = useCallback(
    (selectedFile: File) => {
      if (!selectedFile.name.toLowerCase().endsWith(".csv")) {
        setErrorMessage(
          "Only .csv files are supported. Please select a comma-separated values file (.csv).",
        );
        return;
      }

      setFile(selectedFile);
      setImportResult(null);
      setErrorMessage(null);
      setTimestampCol("");
      setGenerationCol("");

      if (selectedSiteId) {
        runValidation(selectedFile, selectedSiteId);
      }
    },
    [selectedSiteId, runValidation],
  );

  // Re-run validation when user changes column mapping dropdown
  const handleMappingChange = useCallback(
    (newTs: string, newGen: string) => {
      setTimestampCol(newTs);
      setGenerationCol(newGen);

      if (file && selectedSiteId) {
        runValidation(file, selectedSiteId, newTs, newGen);
      }
    },
    [file, selectedSiteId, runValidation],
  );

  // Re-validate if user switches site while file is loaded
  const handleSiteChange = (newSiteId: string) => {
    setSelectedSiteId(newSiteId);
    if (file) {
      runValidation(file, newSiteId, timestampCol, generationCol);
    }
  };

  // Perform actual import of valid rows
  const handleImport = async () => {
    if (!file || !selectedSiteId || !timestampCol || !generationCol) {
      setErrorMessage("Please complete column mapping before importing.");
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("site_id", selectedSiteId);
    formData.append("timestamp_col", timestampCol);
    formData.append("generation_col", generationCol);

    try {
      const res = await api.ingestCsv(formData);
      setImportResult(res);
      setCurrentStep(4);
      refreshHistory(selectedSiteId);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(`${err.message} ${err.hint ? `\nHint: ${err.hint}` : ""}`);
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("An unexpected error occurred during import.");
      }
    } finally {
      setIsImporting(false);
    }
  };

  // Reset entire flow for a new file
  const handleReset = () => {
    setFile(null);
    setValidationResult(null);
    setImportResult(null);
    setErrorMessage(null);
    setTimestampCol("");
    setGenerationCol("");
    setCurrentStep(1);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Download skipped rows as client-side CSV
  const handleDownloadSkipped = () => {
    if (!importResult || importResult.skipped_rows_data.length === 0) return;

    const headers = ["row_index", "raw_timestamp", "raw_generation", "reason"];
    const rows = importResult.skipped_rows_data.map((r) => [
      r.row_index,
      `"${(r.raw_timestamp || "").replace(/"/g, '""')}"`,
      `"${(r.raw_generation || "").replace(/"/g, '""')}"`,
      `"${(r.reason || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `skipped_rows_${selectedSiteId}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="border-b border-[var(--gridline)] pb-4">
        <h1 className="text-20 font-semibold tracking-[-0.01em] text-ink-primary">
          Historical generation data
        </h1>
        <p className="mt-0.5 text-12 text-ink-secondary">
          Upload measured generation data to compare forecasts with actual output.
        </p>
      </header>

      {/* ── Plant & Site Selector ───────────────────────────────────────── */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-[var(--ring)] bg-surface p-4">
        {selectedSite ? (
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <span className="text-11 font-medium text-ink-muted">Plant</span>
              <p className="text-14 font-semibold text-ink-primary">{selectedSite.name}</p>
            </div>
            <div className="h-8 w-px bg-[var(--gridline)] hidden sm:block" />
            <div>
              <span className="text-11 font-medium text-ink-muted">Capacity</span>
              <p className="text-14 font-semibold tabular-nums text-ink-primary">
                {mw(selectedSite.capacity_mw)}
              </p>
            </div>
            <div className="h-8 w-px bg-[var(--gridline)] hidden sm:block" />
            <div>
              <span className="text-11 font-medium text-ink-muted">Technology</span>
              <p className="text-14 font-semibold text-ink-primary">
                {technologyLabel(selectedSite.technology)}
              </p>
            </div>
            <div className="h-8 w-px bg-[var(--gridline)] hidden sm:block" />
            <div>
              <span className="text-11 font-medium text-ink-muted">Actuals in store</span>
              <p className="text-14 font-semibold tabular-nums text-ink-primary">
                {siteHistory ? `${siteHistory.actuals_count.toLocaleString("en-IN")} records` : "0 records"}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-12 text-ink-muted">Loading sites...</p>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor={siteSelectId} className="text-11 font-medium text-ink-muted">
            Select site:
          </label>
          <select
            id={siteSelectId}
            value={selectedSiteId}
            onChange={(e) => handleSiteChange(e.target.value)}
            disabled={loadingSites || isValidating || isImporting}
            className="rounded-control border border-[var(--ring)] bg-surface px-2.5 py-1 text-12 font-medium text-ink-primary cursor-pointer focus:outline-none focus:border-ink-primary"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.capacity_mw.toLocaleString("en-IN")} MW {s.technology})
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* ── Global Error Banner ─────────────────────────────────────────── */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-panel border border-[var(--status-critical)] bg-surface p-4 text-12"
        >
          <span className="mt-0.5">
            <StatusDot level="critical" />
          </span>
          <div>
            <strong className="font-semibold text-ink-primary">Upload or validation issue</strong>
            <p className="mt-0.5 whitespace-pre-line text-ink-secondary">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* ── Step 1: Upload CSV Area ─────────────────────────────────────── */}
      {currentStep !== 4 && (
        <Panel
          title="1. Upload CSV"
          meta={file ? `${(file.size / 1024).toFixed(1)} KB` : "CSV up to 10 MB"}
          action={
            file ? (
              <button
                type="button"
                onClick={handleReset}
                className="text-11 text-ink-muted hover:text-ink-primary underline cursor-pointer"
              >
                Choose different file
              </button>
            ) : null
          }
        >
          <div className="p-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />

            {!file ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleFileSelect(f);
                }}
                className={`flex flex-col items-center justify-center gap-3 rounded-panel border-2 border-dashed px-6 py-8 text-center transition-colors ${
                  isDragOver
                    ? "border-[var(--series-1)] bg-[var(--page)]"
                    : "border-[var(--ring)] bg-surface hover:border-[var(--baseline)]"
                }`}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-ink-muted"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>

                <div>
                  <p className="text-14 font-medium text-ink-primary">
                    Drop CSV here or click to browse
                  </p>
                  <p className="mt-1 text-11 text-ink-muted">
                    Supports 15-minute or hourly generation records with timestamp and MW columns
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-control border border-[var(--ring)] bg-[var(--page)] px-4 py-1.5 text-12 font-medium text-ink-primary hover:bg-[var(--surface)] transition-colors cursor-pointer"
                >
                  Browse CSV
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-panel border border-[var(--gridline)] bg-[var(--page)] px-4 py-3 text-12">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-14 text-ink-muted">CSV</span>
                  <div>
                    <p className="font-medium text-ink-primary">{file.name}</p>
                    <p className="text-11 text-ink-muted">
                      {(file.size / 1024).toFixed(1)} KB · Selected for {selectedSite.name}
                    </p>
                  </div>
                </div>

                {isValidating ? (
                  <span className="inline-flex items-center gap-2 text-11 text-ink-secondary">
                    <span className="size-2 rounded-pill bg-[var(--series-1)] animate-ping" />
                    Validating rows...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-11 text-ink-secondary font-medium">
                    <StatusDot level="good" /> Loaded
                  </span>
                )}
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* ── Step 2: Column Mapping ───────────────────────────────────────── */}
      {file && validationResult && currentStep !== 4 && (
        <Panel
          title="2. Column mapping"
          meta={`${validationResult.headers.length} columns detected in CSV`}
        >
          <div className="p-4">
            <p className="text-12 text-ink-secondary mb-3">
              Match the CSV columns to RenewCast fields. Obvious names are auto-selected. Ambiguous
              names require confirmation.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-12">
                <thead>
                  <tr className="border-b border-[var(--gridline)]">
                    <Th>RenewCast field</Th>
                    <Th>CSV column</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--gridline)]">
                  <tr>
                    <Td>
                      <div className="font-medium text-ink-primary">Timestamp</div>
                      <span className="text-11 text-ink-muted">
                        ISO 8601 or date/time (e.g. 2026-06-01 10:15)
                      </span>
                    </Td>
                    <Td>
                      <select
                        aria-label="Timestamp CSV column"
                        value={timestampCol}
                        onChange={(e) => handleMappingChange(e.target.value, generationCol)}
                        className="rounded-control border border-[var(--ring)] bg-surface px-2.5 py-1 text-12 text-ink-primary focus:outline-none focus:border-ink-primary cursor-pointer w-full max-w-xs"
                      >
                        <option value="">-- Select timestamp column --</option>
                        {validationResult.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td>
                      {timestampCol ? (
                        <span className="inline-flex items-center gap-1.5 text-11 font-medium text-[var(--delta-pos)]">
                          <StatusDot level="good" /> Mapped
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-11 font-medium text-[var(--status-critical)]">
                          <StatusDot level="critical" /> Required
                        </span>
                      )}
                    </Td>
                  </tr>

                  <tr>
                    <Td>
                      <div className="font-medium text-ink-primary">Generation (MW)</div>
                      <span className="text-11 text-ink-muted">
                        Active metered generation in megawatts
                      </span>
                    </Td>
                    <Td>
                      <select
                        aria-label="Generation CSV column"
                        value={generationCol}
                        onChange={(e) => handleMappingChange(timestampCol, e.target.value)}
                        className="rounded-control border border-[var(--ring)] bg-surface px-2.5 py-1 text-12 text-ink-primary focus:outline-none focus:border-ink-primary cursor-pointer w-full max-w-xs"
                      >
                        <option value="">-- Select generation column --</option>
                        {validationResult.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td>
                      {generationCol ? (
                        <span className="inline-flex items-center gap-1.5 text-11 font-medium text-[var(--delta-pos)]">
                          <StatusDot level="good" /> Mapped
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-11 font-medium text-[var(--status-critical)]">
                          <StatusDot level="critical" /> Required
                        </span>
                      )}
                    </Td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      )}

      {/* ── Step 3: Validation Preview ───────────────────────────────────── */}
      {file && validationResult && currentStep !== 4 && (
        <Panel
          title="3. Validation preview"
          meta={
            validationResult.total_rows > 0
              ? `Previewing first ${Math.min(20, validationResult.total_rows)} of ${validationResult.total_rows.toLocaleString("en-IN")} rows`
              : undefined
          }
        >
          <div className="p-4 flex flex-col gap-4">
            {/* Validation Metrics Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-panel border border-[var(--gridline)] bg-[var(--page)] p-3 text-12">
              <div>
                <span className="text-11 text-ink-muted">Total rows</span>
                <p className="text-17 font-semibold tabular-nums text-ink-primary">
                  {validationResult.total_rows.toLocaleString("en-IN")}
                </p>
              </div>

              <div>
                <span className="text-11 text-ink-muted">Valid rows</span>
                <p className="text-17 font-semibold tabular-nums text-[var(--delta-pos)] flex items-center gap-1.5">
                  <StatusDot level="good" />
                  {validationResult.valid_rows_count.toLocaleString("en-IN")}
                </p>
              </div>

              <div>
                <span className="text-11 text-ink-muted">Skipped rows</span>
                <p
                  className={`text-17 font-semibold tabular-nums flex items-center gap-1.5 ${
                    validationResult.invalid_rows_count > 0
                      ? "text-[var(--status-critical)]"
                      : "text-ink-muted"
                  }`}
                >
                  <StatusDot
                    level={validationResult.invalid_rows_count > 0 ? "critical" : "good"}
                  />
                  {validationResult.invalid_rows_count.toLocaleString("en-IN")}
                </p>
              </div>

              <div>
                <span className="text-11 text-ink-muted">Detected resolution</span>
                <p className="text-14 font-semibold text-ink-primary mt-1">
                  <span className="rounded px-1.5 py-0.5 text-11 bg-surface border border-[var(--ring)]">
                    {validationResult.resolution === "15-minute"
                      ? "15-minute (Grid aligned)"
                      : validationResult.resolution === "hourly"
                        ? "Hourly"
                        : "Other"}
                  </span>
                </p>
              </div>
            </div>

            {/* Ordering and Duplicate Alerts */}
            {!validationResult.is_chronological && (
              <div className="flex items-center gap-2 text-12 text-[var(--status-serious)]">
                <StatusDot level="serious" />
                <span>
                  Notice: Records are not in chronological order. Despatch blocks will be computed
                  from individual timestamps.
                </span>
              </div>
            )}

            {validationResult.duplicate_count > 0 && (
              <div className="flex items-center gap-2 text-12 text-[var(--status-warning)]">
                <StatusDot level="warning" />
                <span>
                  Warning: {validationResult.duplicate_count} duplicate timestamps found in file.
                  The first occurrence will be imported; subsequent duplicates will be skipped.
                </span>
              </div>
            )}

            {/* Summary Message */}
            <p className="text-12 text-ink-secondary">{validationResult.summary_message}</p>

            {/* Preview Table */}
            {validationResult.preview_rows.length > 0 ? (
              <div className="overflow-x-auto rounded-panel border border-[var(--gridline)]">
                <table className="w-full text-left text-12">
                  <thead className="bg-[var(--page)] border-b border-[var(--gridline)]">
                    <tr>
                      <Th width="60px">Row</Th>
                      <Th>Raw timestamp</Th>
                      <Th width="80px">Block</Th>
                      <Th>Raw generation</Th>
                      <Th numeric width="120px">
                        MW
                      </Th>
                      <Th>Validation status</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--gridline)]">
                    {validationResult.preview_rows.map((r) => (
                      <tr
                        key={r.row_index}
                        className={!r.valid ? "bg-[var(--page)]" : undefined}
                      >
                        <Td muted>{r.row_index}</Td>
                        <Td>
                          <span className="font-mono text-11">{r.raw_timestamp || "—"}</span>
                        </Td>
                        <Td>
                          {r.block ? (
                            <span className="tabular-nums font-medium text-ink-primary">
                              #{r.block}
                            </span>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </Td>
                        <Td>
                          <span className="font-mono text-11">{r.raw_generation || "—"}</span>
                        </Td>
                        <Td numeric>
                          {r.generation_mw !== null ? (
                            <span className="font-semibold">{r.generation_mw.toFixed(1)}</span>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </Td>
                        <Td>
                          {r.valid ? (
                            <span className="inline-flex items-center gap-1.5 text-11 font-medium text-[var(--delta-pos)]">
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              Valid
                            </span>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <span className="inline-flex items-center gap-1.5 text-11 font-semibold text-[var(--status-critical)]">
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <circle cx="12" cy="12" r="10" />
                                  <line x1="12" y1="8" x2="12" y2="12" />
                                  <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                                Invalid
                              </span>
                              <span className="text-11 text-ink-secondary">
                                {r.errors.join("; ")}
                              </span>
                            </div>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-12 text-ink-muted italic py-4">
                Map both Timestamp and Generation (MW) above to see validation preview.
              </p>
            )}

            {/* Import Action */}
            <div className="flex items-center justify-between pt-2">
              <span className="text-11 text-ink-muted">
                {validationResult.valid_rows_count > 0
                  ? `Ready to import ${validationResult.valid_rows_count.toLocaleString("en-IN")} valid records into the actuals store.`
                  : "No valid rows available to import. Check column mappings or CSV format."}
              </span>

              <button
                type="button"
                onClick={handleImport}
                disabled={validationResult.valid_rows_count === 0 || isImporting}
                className={`rounded-control px-5 py-2 text-13 font-semibold transition-colors cursor-pointer ${
                  validationResult.valid_rows_count > 0 && !isImporting
                    ? "bg-[var(--series-1)] text-white hover:opacity-90"
                    : "bg-[var(--baseline)] text-ink-muted cursor-not-allowed"
                }`}
              >
                {isImporting ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2 rounded-pill bg-white animate-ping" />
                    Importing...
                  </span>
                ) : (
                  `Import ${validationResult.valid_rows_count.toLocaleString("en-IN")} valid rows`
                )}
              </button>
            </div>
          </div>
        </Panel>
      )}

      {/* ── Step 4: Import Result ────────────────────────────────────────── */}
      {currentStep === 4 && importResult && (
        <Panel
          title="4. Import result"
          meta={importResult.skipped_rows === 0 ? "Complete success" : "Partial import"}
        >
          <div className="p-6 flex flex-col gap-6">
            {/* Status Headline */}
            <div className="flex items-start gap-3">
              <span className="mt-1">
                <StatusDot level={importResult.imported_rows > 0 ? "good" : "critical"} />
              </span>
              <div>
                <h3 className="text-17 font-semibold text-ink-primary">
                  {importResult.imported_rows > 0
                    ? importResult.skipped_rows === 0
                      ? "Import complete"
                      : "Partial import complete"
                    : "Import failed"}
                </h3>
                <p className="mt-1 text-13 text-ink-secondary">{importResult.message}</p>
              </div>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 rounded-panel border border-[var(--gridline)] bg-[var(--page)] p-4">
              <div>
                <span className="text-11 text-ink-muted">Imported</span>
                <p className="text-17 font-semibold tabular-nums text-[var(--delta-pos)]">
                  {importResult.imported_rows.toLocaleString("en-IN")} rows
                </p>
              </div>

              <div>
                <span className="text-11 text-ink-muted">Skipped</span>
                <p
                  className={`text-17 font-semibold tabular-nums ${
                    importResult.skipped_rows > 0 ? "text-[var(--status-critical)]" : "text-ink-muted"
                  }`}
                >
                  {importResult.skipped_rows.toLocaleString("en-IN")} rows
                </p>
              </div>

              <div>
                <span className="text-11 text-ink-muted">Coverage</span>
                <p className="text-13 font-semibold text-ink-primary mt-1">
                  {importResult.date_range_start && importResult.date_range_end
                    ? `${importResult.date_range_start} – ${importResult.date_range_end}`
                    : "—"}
                </p>
              </div>

              <div>
                <span className="text-11 text-ink-muted">Site</span>
                <p className="text-13 font-semibold text-ink-primary mt-1">
                  {importResult.site_name}
                </p>
              </div>

              <div>
                <span className="text-11 text-ink-muted">Resolution</span>
                <p className="text-13 font-semibold text-ink-primary mt-1">
                  {importResult.resolution}
                </p>
              </div>
            </div>

            {/* Recovery Option for Skipped Rows */}
            {importResult.skipped_rows > 0 && (
              <div className="flex flex-col gap-3 rounded-panel border border-[var(--ring)] bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-13 font-semibold text-ink-primary">
                      Skipped rows recovery ({importResult.skipped_rows.toLocaleString("en-IN")} rows)
                    </h4>
                    <p className="text-11 text-ink-muted">
                      Download the skipped rows to inspect errors or fix them for re-upload.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleDownloadSkipped}
                    className="inline-flex items-center gap-1.5 rounded-control border border-[var(--ring)] bg-surface px-3 py-1.5 text-12 font-medium text-ink-primary hover:bg-[var(--page)] transition-colors cursor-pointer"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download skipped rows (.csv)
                  </button>
                </div>

                {/* Sample of skipped rows */}
                <div className="max-h-60 overflow-y-auto rounded border border-[var(--gridline)]">
                  <table className="w-full text-left text-11">
                    <thead className="bg-[var(--page)] sticky top-0 border-b border-[var(--gridline)]">
                      <tr>
                        <Th width="60px">Row</Th>
                        <Th>Raw timestamp</Th>
                        <Th>Raw generation</Th>
                        <Th>Reason for skip</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--gridline)] font-mono">
                      {importResult.skipped_rows_data.slice(0, 50).map((s) => (
                        <tr key={s.row_index}>
                          <Td muted>{s.row_index}</Td>
                          <Td>{s.raw_timestamp || "—"}</Td>
                          <Td>{s.raw_generation || "—"}</Td>
                          <Td>
                            <span className="font-sans text-ink-secondary">{s.reason}</span>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleReset}
                className="rounded-control border border-[var(--ring)] bg-surface px-4 py-2 text-12 font-semibold text-ink-primary hover:bg-[var(--page)] transition-colors cursor-pointer"
              >
                Upload another dataset
              </button>

              <Link
                href={`/sites/${selectedSiteId}`}
                className="rounded-control bg-[var(--series-1)] text-white px-4 py-2 text-12 font-semibold hover:opacity-90 transition-opacity"
              >
                View site details & forecast
              </Link>

              <Link
                href="/accuracy"
                className="rounded-control border border-[var(--ring)] bg-surface px-4 py-2 text-12 font-medium text-ink-secondary hover:text-ink-primary hover:bg-[var(--page)] transition-colors"
              >
                View accuracy metrics
              </Link>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
