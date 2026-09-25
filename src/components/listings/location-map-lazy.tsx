"use client";

import dynamic from "next/dynamic";

export const LocationMapLazy = dynamic(() => import("./location-map"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-sunken" />,
});
