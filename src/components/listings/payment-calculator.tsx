"use client";

import { useMemo, useState } from "react";
import { site } from "@/config/site";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { estimateMonthlyCost } from "@/lib/mortgage";

const SEGMENTS = [
  { key: "principalAndInterest", label: "Principal & interest", color: "bg-brand-700" },
  { key: "taxes", label: "Property taxes", color: "bg-brand-400" },
  { key: "insurance", label: "Home insurance", color: "bg-brass-400" },
  { key: "hoa", label: "HOA dues", color: "bg-clay-500" },
  { key: "pmi", label: "Mortgage insurance", color: "bg-status-soon" },
] as const;

/**
 * The full monthly cost — portals often show principal & interest only.
 * Taxes come from the listing when available, else the market's typical rate.
 */
export function PaymentCalculator({
  price,
  annualTax,
  monthlyHoa,
}: {
  price: number;
  annualTax: number | null;
  monthlyHoa: number;
}) {
  const f = site.finance;
  const [homePrice, setHomePrice] = useState(price);
  const [downPct, setDownPct] = useState<number>(f.downPaymentPct);
  const [rate, setRate] = useState<number>(f.interestRate);
  const [term, setTerm] = useState<number>(f.loanTermYears);

  const cost = useMemo(
    () =>
      estimateMonthlyCost({
        price: homePrice,
        downPaymentPct: downPct,
        interestRatePct: rate,
        loanTermYears: term,
        // Scale the listed tax with the price the user is exploring.
        annualTax: annualTax
          ? annualTax * (homePrice / price)
          : (homePrice * f.propertyTaxRatePct) / 100,
        annualInsurance: (homePrice * f.insuranceRatePct) / 100,
        monthlyHoa,
      }),
    [
      homePrice,
      downPct,
      rate,
      term,
      annualTax,
      price,
      monthlyHoa,
      f.propertyTaxRatePct,
      f.insuranceRatePct,
    ],
  );

  const segments = SEGMENTS.filter((s) => cost[s.key] > 0);

  return (
    <div className="grid grid-cols-1 gap-8 rounded-3xl border border-line bg-surface p-6 sm:p-8 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <p className="text-sm text-muted">Estimated monthly cost</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight text-ink tabular">
          {formatPrice(Math.round(cost.total))}
          <span className="text-base font-normal text-muted">/mo</span>
        </p>
        <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-sunken" aria-hidden>
          {segments.map((s) => (
            <div
              key={s.key}
              className={cn(s.color, "h-full")}
              style={{ width: `${(cost[s.key] / cost.total) * 100}%` }}
            />
          ))}
        </div>
        <dl className="mt-5 space-y-2.5">
          {segments.map((s) => (
            <div key={s.key} className="flex items-center justify-between text-sm">
              <dt className="flex items-center gap-2 text-ink-soft">
                <span className={cn("size-2.5 rounded-full", s.color)} />
                {s.label}
              </dt>
              <dd className="font-medium text-ink tabular">
                {formatPrice(Math.round(cost[s.key]))}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <NumberField
          label="Home price"
          prefix="$"
          value={homePrice}
          step={5000}
          min={0}
          onChange={setHomePrice}
        />
        <div>
          <NumberField
            label="Down payment"
            suffix="%"
            value={downPct}
            step={1}
            min={0}
            max={100}
            onChange={setDownPct}
          />
          <p className="mt-1 text-xs text-muted">
            {formatPrice(Math.round((homePrice * downPct) / 100))}
          </p>
        </div>
        <NumberField
          label="Interest rate"
          suffix="%"
          value={rate}
          step={0.125}
          min={0}
          max={20}
          onChange={setRate}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-soft">Loan term</span>
          <select
            value={term}
            onChange={(e) => setTerm(Number(e.target.value))}
            className="h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm"
          >
            {[30, 20, 15, 10].map((y) => (
              <option key={y} value={y}>
                {y}-year fixed
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs leading-relaxed text-faint sm:col-span-2 lg:col-span-1 xl:col-span-2">
          Estimate only. Taxes use the listing&apos;s most recent figure where available; insurance
          assumes {f.insuranceRatePct}% of price per year. Mortgage insurance applies below 20%
          down.
        </p>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  step: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-soft">{label}</span>
      <span className="flex h-11 items-center rounded-xl border border-line-strong bg-surface px-3 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-100">
        {prefix && <span className="mr-1 text-muted">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          className="w-full min-w-0 bg-transparent text-sm text-ink tabular outline-none"
          value={Number.isFinite(value) ? value : ""}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n))
              onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
          }}
        />
        {suffix && <span className="ml-1 text-muted">{suffix}</span>}
      </span>
    </label>
  );
}
