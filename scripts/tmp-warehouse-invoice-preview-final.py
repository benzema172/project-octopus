from pathlib import Path

path = Path("components/company/warehouse-workspace-300.tsx")
source = path.read_text()

replacements = [
    (
        'import { ModuleDropzoneLink } from "@/components/documents/module-dropzone-link";',
        'import { InvoiceQuickPreview } from "@/components/documents/invoice-quick-preview";\nimport { ModuleDropzoneLink } from "@/components/documents/module-dropzone-link";',
    ),
    (
        '{selectedItemId ? <ItemDrawer key={selectedItemId} item={itemById.get(selectedItemId)} itemId={selectedItemId} catalogItems={catalogItems} balances={balances} reservations={reservations} aliases={aliases} prices={pricesByItem.get(selectedItemId) ?? []} fifo={fifoByItem.get(selectedItemId)} warehouses={warehouseById} counterparties={counterpartyById} locations={locations} locationAssignments={locationAssignments} locationById={locationById} canWrite={canWrite} pending={pending} onClose={() => setSelectedItemId(null)} act={atomicAct} /> : null}',
        '{selectedItemId ? <ItemDrawer key={selectedItemId} workspaceId={workspaceId} item={itemById.get(selectedItemId)} itemId={selectedItemId} catalogItems={catalogItems} balances={balances} reservations={reservations} aliases={aliases} prices={pricesByItem.get(selectedItemId) ?? []} fifo={fifoByItem.get(selectedItemId)} warehouses={warehouseById} counterparties={counterpartyById} locations={locations} locationAssignments={locationAssignments} locationById={locationById} canWrite={canWrite} pending={pending} onClose={() => setSelectedItemId(null)} act={atomicAct} /> : null}',
    ),
    (
        'function ItemDrawer({ item, itemId, catalogItems, balances, reservations, aliases, prices, fifo, warehouses, counterparties, locations, locationAssignments, locationById, canWrite, pending, onClose, act }: {\n  item?: Row;',
        'function ItemDrawer({ workspaceId, item, itemId, catalogItems, balances, reservations, aliases, prices, fifo, warehouses, counterparties, locations, locationAssignments, locationById, canWrite, pending, onClose, act }: {\n  workspaceId: string;\n  item?: Row;',
    ),
]

old_panel = '''    <Panel title="Ostatnie zakupy i ceny" icon={<History size={15} />}>{prices.slice(0, 16).map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{money(row.unit_price_net, text(row.currency,"PLN"))} / {text(row.unit,item.unit as string)}</strong><small>{text(counterparties.get(String(row.counterparty_id))?.name)} · {dateLabel(row.observed_at)}</small></span></div>)}{!prices.length ? <Empty label="Historia cen pojawi się po rozpoznanych zakupach." /> : null}</Panel>'''
new_panel = '''    <Panel title="Ostatnie zakupy i ceny" icon={<History size={15} />}>
      {prices.slice(0, 16).map((row) => {
        const directInvoiceLineId = String(row.invoice_line_id ?? "").trim();
        const sourceInvoiceLineId = String(row.source_type ?? "") === "invoice_line" ? String(row.source_id ?? "").trim() : "";
        const invoiceLineId = directInvoiceLineId || sourceInvoiceLineId || null;
        const invoiceId = String(row.invoice_id ?? "").trim() || null;
        const invoiceNumber = String(row.invoice_number ?? "").trim() || null;
        return <div className={styles.simpleRow} key={String(row.id)}><span>
          <strong>{money(row.unit_price_net, text(row.currency,"PLN"))} / {text(row.unit,item.unit as string)}</strong>
          <small>{text(counterparties.get(String(row.counterparty_id))?.name)} · {dateLabel(row.observed_at)}{invoiceLineId ? <> · faktura <InvoiceQuickPreview workspaceId={workspaceId} domain="warehouse" invoiceLineId={invoiceLineId} invoiceId={invoiceId} invoiceNumber={invoiceNumber} stockItemId={itemId}>{invoiceNumber ? `FV ${invoiceNumber.replace(/^FV\\s+/i, "")}` : "podgląd"}</InvoiceQuickPreview></> : null}</small>
        </span></div>;
      })}
      {!prices.length ? <Empty label="Historia cen pojawi się po rozpoznanych zakupach." /> : null}
    </Panel>'''
replacements.append((old_panel, new_panel))

for old, new in replacements:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match, got {count}: {old[:120]!r}")
    source = source.replace(old, new, 1)

malformed = 'label={query ? "Brak kartotek dla tego wyszukiwania." : "Brak kartotek." /> : null}'
if malformed in source:
    raise SystemExit("Detected malformed StockRegistry JSX from the abandoned attempt.")
path.write_text(source)

Path("tests/warehouse-item-invoice-preview-460.test.ts").write_text('''import { describe, expect, it } from "vitest";\nimport { readFileSync } from "node:fs";\n\ndescribe("Warehouse item invoice preview 4.6", () => {\n  const workspace = readFileSync("components/company/warehouse-workspace-300.tsx", "utf8");\n  const history = readFileSync("lib/data/warehouse-price-history-450.ts", "utf8");\n  const loader = readFileSync("lib/data/warehouse-market-400.ts", "utf8");\n\n  it("uses the shared invoice quick preview in item purchase history", () => {\n    expect(workspace).toContain('import { InvoiceQuickPreview } from "@/components/documents/invoice-quick-preview";');\n    expect(workspace).toContain('domain="warehouse" invoiceLineId={invoiceLineId}');\n    expect(workspace).toContain('stockItemId={itemId}');\n    expect(workspace).toContain('String(row.source_type ?? "") === "invoice_line"');\n  });\n\n  it("feeds exact invoice and invoice-line identifiers into warehouse price rows", () => {\n    expect(history).toContain('invoice_line_id: line ? sourceId : null');\n    expect(history).toContain('invoice_line_id: invoiceLineId');\n    expect(loader).toContain('enrichWarehousePriceHistory450(workspaceId, globalPriceRows)');\n    expect(loader).toContain('globalPriceObservations: enrichedGlobalPrices');\n  });\n\n  it("keeps StockRegistry empty-state JSX valid", () => {\n    expect(workspace).toContain('<Empty label={query ? "Brak kartotek dla tego wyszukiwania." : "Brak kartotek."} />');\n    expect(workspace).not.toContain('label={query ? "Brak kartotek dla tego wyszukiwania." : "Brak kartotek." />');\n  });\n});\n''')
