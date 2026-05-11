'use client';

import * as React from 'react';
import { X, Plus, Calendar, Globe2, Layers, Package } from 'lucide-react';
import { cn } from '@/lib/ui-utils';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { FilterState } from '@/types/chat';

interface FilterChipsProps {
  filters: FilterState;
  onChange: (next: FilterState) => void;
}

const PERIOD_OPTIONS: Array<{ key: string; label: string; days: number }> = [
  { key: '7d', label: 'Últimos 7 dias', days: 7 },
  { key: '14d', label: 'Últimos 14 dias', days: 14 },
  { key: '30d', label: 'Últimos 30 dias', days: 30 },
  { key: '90d', label: 'Últimos 90 dias', days: 90 },
];

const PLATFORM_OPTIONS = [
  { value: 'clickbank', label: 'ClickBank' },
  { value: 'digistore24', label: 'Digistore24' },
];

const FAMILY_OPTIONS = [
  'NeuroMindPro',
  'GlycoPulse',
  'ThermoBurnPro',
  'MaxVitalize',
  'FlexImmuneGuard',
  'NightCalm',
];

export function FilterChips({ filters, onChange }: FilterChipsProps) {
  function setPeriod(key: string) {
    const opt = PERIOD_OPTIONS.find((p) => p.key === key);
    if (!opt) return;
    const end = new Date();
    const start = new Date(end.getTime() - opt.days * 24 * 3600 * 1000);
    onChange({
      ...filters,
      period: {
        preset: key,
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      },
    });
  }
  function togglePlatform(v: string) {
    const next = filters.platforms.includes(v)
      ? filters.platforms.filter((p) => p !== v)
      : [...filters.platforms, v];
    onChange({ ...filters, platforms: next });
  }
  function toggleFamily(v: string) {
    const next = filters.families.includes(v)
      ? filters.families.filter((p) => p !== v)
      : [...filters.families, v];
    onChange({ ...filters, families: next });
  }
  function removeAllPlatforms() {
    onChange({ ...filters, platforms: [] });
  }
  function removeAllFamilies() {
    onChange({ ...filters, families: [] });
  }
  function removeAllCountries() {
    onChange({ ...filters, countries: [] });
  }

  const periodLabel = PERIOD_OPTIONS.find((p) => p.key === filters.period.preset)?.label
    ?? 'Período custom';

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs">
      {/* Período */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip icon={<Calendar className="w-3 h-3" />}>
            {periodLabel}
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Período</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PERIOD_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.key}
              onSelect={() => setPeriod(opt.key)}
              className={cn(filters.period.preset === opt.key && 'bg-accent')}
            >
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Plataforma */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip icon={<Layers className="w-3 h-3" />} active={filters.platforms.length > 0}>
            {filters.platforms.length === 0
              ? 'Todas plataformas'
              : `${filters.platforms.length} plataforma${filters.platforms.length === 1 ? '' : 's'}`}
            {filters.platforms.length > 0 && (
              <ChipX onClick={(e) => { e.stopPropagation(); removeAllPlatforms(); }} />
            )}
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Plataformas</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PLATFORM_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => togglePlatform(opt.value)}
              className={cn(filters.platforms.includes(opt.value) && 'bg-accent')}
            >
              <div className="w-3 h-3 rounded border border-border flex items-center justify-center">
                {filters.platforms.includes(opt.value) && (
                  <div className="w-1.5 h-1.5 rounded-sm bg-primary" />
                )}
              </div>
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Família/Produto */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip icon={<Package className="w-3 h-3" />} active={filters.families.length > 0}>
            {filters.families.length === 0
              ? 'Todos produtos'
              : `${filters.families.length} família${filters.families.length === 1 ? '' : 's'}`}
            {filters.families.length > 0 && (
              <ChipX onClick={(e) => { e.stopPropagation(); removeAllFamilies(); }} />
            )}
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Famílias</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {FAMILY_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt}
              onSelect={() => toggleFamily(opt)}
              className={cn(filters.families.includes(opt) && 'bg-accent')}
            >
              <div className="w-3 h-3 rounded border border-border flex items-center justify-center">
                {filters.families.includes(opt) && (
                  <div className="w-1.5 h-1.5 rounded-sm bg-primary" />
                )}
              </div>
              {opt}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* País — placeholder por ora (precisa lista de paises do backend) */}
      <Chip icon={<Globe2 className="w-3 h-3" />} active={filters.countries.length > 0}>
        {filters.countries.length === 0
          ? 'Todos países'
          : `${filters.countries.length} país${filters.countries.length === 1 ? '' : 'es'}`}
        {filters.countries.length > 0 && (
          <ChipX onClick={(e) => { e.stopPropagation(); removeAllCountries(); }} />
        )}
      </Chip>

      <button className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
        <Plus className="w-3 h-3" /> Filtro
      </button>
    </div>
  );
}

const Chip = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode;
  active?: boolean;
  children?: React.ReactNode;
}>(({ icon, active, children, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-colors',
      active
        ? 'bg-primary/10 border-primary/30 text-primary'
        : 'bg-card border-border text-foreground hover:bg-accent',
      className,
    )}
    {...props}
  >
    {icon}
    {children}
  </button>
));
Chip.displayName = 'Chip';

function ChipX(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="ml-1 opacity-60 hover:opacity-100"
      aria-label="Remover filtro"
    >
      <X className="w-3 h-3" />
    </button>
  );
}
