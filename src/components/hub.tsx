"use client";

import Link from "next/link";
import { COMPANIONS } from "@/lib/companions";

export function Hub() {
  const companions = Object.values(COMPANIONS);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-light mb-4 tracking-tight text-slate-900">
            What do you need right now?
          </h1>
          <p className="text-lg text-slate-600">
            Five tools. One conversation each. Pick what applies to your life today.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {companions.map((companion) => (
            <Link
              key={companion.id}
              href={`/${companion.id}`}
              className="group block"
            >
              <div
                className="h-40 rounded-lg mb-4 transition-transform group-hover:scale-105"
                style={{ backgroundColor: companion.iconTile }}
              />
              <h2 className="text-xl font-semibold text-slate-900 mb-2 group-hover:text-slate-700">
                {companion.name}
              </h2>
              <p className="text-slate-600 mb-3">{companion.tagline}</p>
              <p className="text-sm text-slate-500 line-clamp-2">
                {companion.description}
              </p>
            </Link>
          ))}
        </div>

        <div className="text-center text-sm text-slate-500 mt-12">
          <p>No saved conversations. Each visit is fresh. No database. Your questions stay with you.</p>
        </div>
      </div>
    </div>
  );
}
