"use client";

import type { PeakMetrics, SortDirection, SortField } from "@/lib/types";
import { Fragment, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "@/ui/icon-registry";
import { Table, TBody, TCell, THead, TH, TRow } from "@/ui";
import { formatNumber, formatDurationOrUnavailable } from "@/lib/formatters";
import { getModelColor } from "@/features/usage/colors";
import {
  modelDisplayName,
  resolveSpeedDisplay,
  type ModelData,
  type SpeedDisplay,
} from "./model-performance-table-model";

interface ModelPerformanceTableProps {
  sortedModels: ModelData[];
  peakMetrics: Map<string, PeakMetrics>;
  expandedRows: Set<string>;
  sortField: SortField;
  sortDirection: SortDirection;
  handleSort: (field: SortField) => void;
  toggleRow: (model: string) => void;
}

export function ModelPerformanceTable({
  expandedRows,
  handleSort,
  peakMetrics,
  sortDirection,
  sortField,
  sortedModels,
  toggleRow,
}: ModelPerformanceTableProps) {
  return (
    <section className="px-2 pt-2 pb-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono text-[length:var(--fs-2xs)] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          Model performance
        </div>
        <div className="font-mono text-[length:var(--fs-xs)] text-(--dim)">
          <span className="tabular-nums text-(--fg)">{sortedModels.length}</span> models
        </div>
      </div>

      <Table
        bordered={false}
        className="border-b border-(--border)/40"
        tableClassName="text-[length:var(--fs-md)]"
      >
        <THead className="bg-transparent">
          <TRow className="border-b border-(--border)/40 hover:bg-transparent">
            <TH className="w-6 px-2 py-2" />
            <SortHeader
              field="model"
              currentField={sortField}
              direction={sortDirection}
              onClick={() => handleSort("model")}
            >
              Model
            </SortHeader>
            <SortHeader
              field="requests"
              currentField={sortField}
              direction={sortDirection}
              onClick={() => handleSort("requests")}
              align="right"
            >
              Requests
            </SortHeader>
            <SortHeader
              field="tokens"
              currentField={sortField}
              direction={sortDirection}
              onClick={() => handleSort("tokens")}
              align="right"
            >
              Tokens
            </SortHeader>
            <SortHeader
              field="success"
              currentField={sortField}
              direction={sortDirection}
              onClick={() => handleSort("success")}
              align="right"
            >
              Success
            </SortHeader>
            <SortHeader
              field="latency"
              currentField={sortField}
              direction={sortDirection}
              onClick={() => handleSort("latency")}
              align="right"
            >
              Latency
            </SortHeader>
            <SortHeader
              field="ttft"
              currentField={sortField}
              direction={sortDirection}
              onClick={() => handleSort("ttft")}
              align="right"
            >
              TTFT
            </SortHeader>
            <SortHeader
              field="speed"
              currentField={sortField}
              direction={sortDirection}
              onClick={() => handleSort("speed")}
              align="right"
            >
              Speed
            </SortHeader>
          </TRow>
        </THead>
        <TBody className="divide-y-0">
          {sortedModels.map((model) => {
            const peak = peakMetrics.get(model.model);
            const isExpanded = expandedRows.has(model.model);
            const modelColor = getModelColor(model.model);

            return (
              <Fragment key={model.model}>
                <TRow
                  className={`cursor-pointer border-b border-(--border)/25 transition-colors hover:bg-(--hover) ${
                    isExpanded ? "bg-(--hover)" : ""
                  }`}
                  onClick={() => toggleRow(model.model)}
                >
                  <TCell className="px-2 py-2">
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-(--dim)" />
                    ) : (
                      <ChevronUp className="h-3 w-3 rotate-[-90deg] text-(--dim)" />
                    )}
                  </TCell>
                  <TCell className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-1 shrink-0" style={{ backgroundColor: modelColor }} />
                      <div
                        className="max-w-[150px] truncate font-mono text-[length:var(--fs-sm)] text-(--fg) sm:max-w-[240px]"
                        title={model.model}
                      >
                        {modelDisplayName(model.model)}
                      </div>
                    </div>
                  </TCell>
                  <TCell align="right" className="px-2 py-2 font-mono tabular-nums text-(--dim)">
                    {formatNumber(model.requests)}
                  </TCell>
                  <TCell align="right" className="px-2 py-2 font-mono tabular-nums text-(--dim)">
                    {formatNumber(model.total_tokens)}
                  </TCell>
                  <TCell align="right" className="px-2 py-2">
                    <StatusPill value={model.success_rate} type="success" />
                  </TCell>
                  <TCell align="right" className="px-2 py-2">
                    <StatusPill value={model.avg_latency_ms} type="latency" />
                  </TCell>
                  <TCell align="right" className="px-2 py-2 font-mono tabular-nums text-(--dim)">
                    {formatDurationOrUnavailable(model.avg_ttft_ms)}
                  </TCell>
                  <TCell align="right" className="px-2 py-2 font-mono">
                    {renderSpeedDisplay(resolveSpeedDisplay(model, peak))}
                  </TCell>
                </TRow>
                {isExpanded ? (
                  <TRow className="border-b border-(--border)/25 hover:bg-transparent">
                    <TCell colSpan={8} className="px-2 py-3">
                      <dl className="grid grid-cols-2 border-y border-(--border)/40 py-3 sm:grid-cols-4">
                        <ExpandedCell
                          label="prompt tokens"
                          value={formatNumber(model.prompt_tokens)}
                        />
                        <ExpandedCell
                          label="completion tokens"
                          value={formatNumber(model.completion_tokens)}
                        />
                        <ExpandedCell
                          label="avg tokens/req"
                          value={formatNumber(model.avg_tokens)}
                        />
                        <ExpandedCell
                          label="p50 latency"
                          value={formatDurationOrUnavailable(model.p50_latency_ms)}
                        />
                        {peak?.prefill_tps ? (
                          <ExpandedCell
                            label="peak prefill"
                            value={`${peak.prefill_tps.toFixed(1)} t/s`}
                          />
                        ) : null}
                        {peak?.generation_tps ? (
                          <ExpandedCell
                            label="peak generation"
                            value={`${peak.generation_tps.toFixed(1)} t/s`}
                          />
                        ) : null}
                        {peak?.ttft_ms ? (
                          <ExpandedCell
                            label="best ttft"
                            value={`${Math.round(peak.ttft_ms)} ms`}
                          />
                        ) : null}
                        {peak?.best_session_prefill_tps ? (
                          <ExpandedCell
                            label="session max prefill"
                            value={`${peak.best_session_prefill_tps.toFixed(1)} t/s`}
                          />
                        ) : null}
                        {peak?.best_session_generation_tps ? (
                          <ExpandedCell
                            label="session max generation"
                            value={`${peak.best_session_generation_tps.toFixed(1)} t/s`}
                          />
                        ) : null}
                      </dl>
                    </TCell>
                  </TRow>
                ) : null}
              </Fragment>
            );
          })}
        </TBody>
      </Table>
    </section>
  );
}

function SortHeader({
  field,
  currentField,
  direction,
  onClick,
  children,
  align = "left",
}: {
  field: SortField;
  currentField: SortField;
  direction: SortDirection;
  onClick: () => void;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const isActive = currentField === field;

  return (
    <TH
      align={align}
      className={`cursor-pointer select-none px-3 py-2 font-mono text-[length:var(--fs-xs)] font-normal uppercase tracking-[0.14em] text-(--dim) transition-colors hover:text-(--fg) ${
        align === "right" ? "text-right" : "text-left"
      }`}
      onClick={onClick}
    >
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {children}
        {isActive && <span>{direction === "asc" ? "↑" : "↓"}</span>}
      </div>
    </TH>
  );
}

function StatusPill({ value, type }: { value: number | null; type: "success" | "latency" }) {
  if (value === null) {
    return (
      <span className="font-mono text-[length:var(--fs-md)] tabular-nums text-(--dim)">
        {type === "success" ? "0.0%" : "0ms"}
      </span>
    );
  }

  const getColor = () => {
    if (type === "success") {
      if (value >= 95) return "text-(--hl2)";
      if (value >= 90) return "text-(--hl3)";
      return "text-(--err)";
    }
    if (value < 500) return "text-(--hl2)";
    if (value < 1500) return "text-(--hl3)";
    return "text-(--err)";
  };

  return (
    <span className={`font-mono text-[length:var(--fs-md)] tabular-nums ${getColor()}`}>
      {type === "success" ? `${value.toFixed(1)}%` : formatDurationOrUnavailable(value)}
    </span>
  );
}

function ExpandedCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-(--border)/40 pr-2 pl-3 first:pl-0 last:border-r-0 sm:pr-4 sm:pl-5">
      <dt className="truncate font-mono text-[length:var(--fs-2xs)] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[length:var(--fs-base)] leading-none tabular-nums text-(--fg)">
        {value}
      </dd>
    </div>
  );
}

function renderSpeedDisplay(speed: SpeedDisplay) {
  if (speed.kind === "empty") {
    return <span className="text-(--dim)">—</span>;
  }
  if (speed.kind === "single") {
    return <span className="tabular-nums text-(--fg)">{speed.text}</span>;
  }
  return (
    <div className={`flex flex-col items-end gap-0.5 ${speed.muted ? "text-(--dim)" : ""}`}>
      {speed.rows.map((row) => (
        <span key={row} className="tabular-nums text-[length:var(--fs-sm)]">
          {row}
        </span>
      ))}
    </div>
  );
}
