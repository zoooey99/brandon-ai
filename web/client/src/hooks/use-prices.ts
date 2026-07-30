import { useEffect, useState } from "react";

interface PriceInfo {
  monthlyAmount: number;
  yearlyAmount: number;
  yearlyMonthly: string;
  savingsPercent: number;
}

const DEFAULT: PriceInfo = {
  monthlyAmount: 15,
  yearlyAmount: 90,
  yearlyMonthly: "7.50",
  savingsPercent: 50,
};

let cached: PriceInfo | null = null;

export function usePrices(): PriceInfo {
  const [prices, setPrices] = useState<PriceInfo>(cached || DEFAULT);

  useEffect(() => {
    if (cached) return;
    fetch("/api/stripe/prices")
      .then((res) => res.json())
      .then((data) => {
        if (!data.prices) return;
        const monthly = data.prices.find(
          (p: any) => p.recurring?.interval === "month"
        );
        const yearly = data.prices.find(
          (p: any) => p.recurring?.interval === "year"
        );
        if (!monthly || !yearly) return;
        const m = monthly.unit_amount / 100;
        const y = yearly.unit_amount / 100;
        const info: PriceInfo = {
          monthlyAmount: m,
          yearlyAmount: y,
          yearlyMonthly: (y / 12).toFixed(2),
          savingsPercent: Math.round(((m * 12 - y) / (m * 12)) * 100),
        };
        cached = info;
        setPrices(info);
      })
      .catch(() => {});
  }, []);

  return prices;
}
