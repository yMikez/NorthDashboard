'use client';

import * as React from 'react';
import type { Block } from '@/types/chat';
import { SummaryBlock } from './SummaryBlock';
import { InsightsBlock } from './InsightsBlock';
import { DataTableBlock } from './DataTableBlock';
import { MarkdownBlock } from './MarkdownBlock';
import { ChartBlock } from './ChartBlock';

export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'summary':
            return <SummaryBlock key={i} block={b} />;
          case 'insights':
            return <InsightsBlock key={i} block={b} />;
          case 'table':
            return <DataTableBlock key={i} block={b} />;
          case 'markdown':
            return <MarkdownBlock key={i} block={b} />;
          case 'chart':
            return <ChartBlock key={i} block={b} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
