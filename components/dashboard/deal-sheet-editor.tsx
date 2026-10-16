"use client";

import type { CSSProperties } from "react";

import { Field, Section, button, fieldLabel, input } from "@/components/dashboard/deal-shared";
import {
  blankSeller,
  type BankDraft,
  type PartyDraft,
  type SellerDraft,
  type SheetDraft,
} from "@/components/dashboard/deal-sheet-draft";
import { PLAYBOOKS } from "@/lib/deal-playbooks";

/**
 * The deal-sheet form. Controlled: the state lives in `DealWorkspace`, because the extraction
 * assist writes into the same state and the curator's Save is what persists either.
 *
 * Privacy (handover §7) is visible in the fields themselves: a party has a PAN *last four* and
 * a bank a loan account *last four*, and there is nowhere to type more.
 */

const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 14px" };

const PAYERS = ["BUYER", "SELLER", "SHARED"] as const;

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <select style={input} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

function PartyFields<T extends PartyDraft>({ value, onChange }: { value: T; onChange: (v: T) => void }) {
  const set = (k: keyof PartyDraft, v: string) => onChange({ ...value, [k]: v });
  return (
    <div style={grid2}>
      <Field text="Name">
        <input style={input} value={value.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field text="Email" hint="Needed for the notices clause.">
        <input style={input} type="email" value={value.email} onChange={(e) => set("email", e.target.value)} />
      </Field>
      <Field text="Phone">
        <input style={input} value={value.phone} onChange={(e) => set("phone", e.target.value)} />
      </Field>
      <Field text="PAN — last 4 only" hint="The full PAN is entered at render time and never stored.">
        <input
          style={input}
          maxLength={4}
          value={value.panLast4}
          onChange={(e) => set("panLast4", e.target.value.toUpperCase())}
        />
      </Field>
    </div>
  );
}

function BankFields({ value, onChange }: { value: BankDraft; onChange: (v: BankDraft) => void }) {
  const set = (k: keyof BankDraft, v: string) => onChange({ ...value, [k]: v });
  return (
    <div style={grid2}>
      <Field text="Bank">
        <input style={input} value={value.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field text="Branch">
        <input style={input} value={value.branch} onChange={(e) => set("branch", e.target.value)} />
      </Field>
      <Field text="Email">
        <input style={input} type="email" value={value.email} onChange={(e) => set("email", e.target.value)} />
      </Field>
      <Field text="Loan account — last 4 only">
        <input style={input} maxLength={4} value={value.loanLast4} onChange={(e) => set("loanLast4", e.target.value)} />
      </Field>
    </div>
  );
}

export function DealSheetEditor({
  value: d,
  onChange,
}: {
  value: SheetDraft;
  onChange: (next: SheetDraft) => void;
}) {
  const set = <K extends keyof SheetDraft>(k: K, v: SheetDraft[K]) => onChange({ ...d, [k]: v });
  const setSeller = (i: number, s: SellerDraft) => set("sellers", d.sellers.map((x, j) => (j === i ? s : x)));
  const isAssignment = d.playbook === "BUILDER_ASSIGNMENT";

  return (
    <>
      <Section title="Property">
        <div style={grid2}>
          <Field text="Playbook" hint="Changing it here does not re-plan milestones already created.">
            <Select value={d.playbook} options={Object.keys(PLAYBOOKS)} onChange={(v) => set("playbook", v)} />
          </Field>
          <Field text="Property">
            <input style={input} value={d.propertyLabel} onChange={(e) => set("propertyLabel", e.target.value)} />
          </Field>
          <Field text="Association name" hint="Must match this project in every document.">
            <input style={input} value={d.associationName} onChange={(e) => set("associationName", e.target.value)} />
          </Field>
          <Field text="Super built-up (sqft)">
            <input style={input} inputMode="decimal" value={d.superBuiltUpSqft} onChange={(e) => set("superBuiltUpSqft", e.target.value)} />
          </Field>
          <Field text={isAssignment ? "Builder" : "Builder (if any)"}>
            <input style={input} value={d.builder} onChange={(e) => set("builder", e.target.value)} />
          </Field>
          <Field text="Builder agreement date">
            <input
              style={input}
              type="date"
              value={d.builderAgreementDate}
              onChange={(e) => set("builderAgreementDate", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Money and dates">
        <div style={grid2}>
          <Field text="Consideration (₹)">
            <input style={input} inputMode="decimal" value={d.considerationRupees} onChange={(e) => set("considerationRupees", e.target.value)} />
          </Field>
          <Field text="Buyer's loan (₹)" hint="Blank: whatever closes the gap to consideration.">
            <input style={input} inputMode="decimal" value={d.loanRupees} onChange={(e) => set("loanRupees", e.target.value)} />
          </Field>
          <Field text="MOU execution date" hint="The deadline runs from here.">
            <input style={input} type="date" value={d.executionDate} onChange={(e) => set("executionDate", e.target.value)} />
          </Field>
          <Field text="Deadline (days)">
            <input style={input} inputMode="numeric" value={d.deadlineDays} onChange={(e) => set("deadlineDays", e.target.value)} />
          </Field>
          <Field text="Extension (days)">
            <input style={input} inputMode="numeric" value={d.extensionDays} onChange={(e) => set("extensionDays", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section
        title="Sellers"
        aside={
          <button
            type="button"
            style={button}
            disabled={d.sellers.length >= 6}
            onClick={() => set("sellers", [...d.sellers, blankSeller()])}
          >
            Add a seller
          </button>
        }
      >
        {d.sellers.map((s, i) => (
          <div key={i} style={{ borderTop: i ? "1px solid #ECE5DB" : undefined, paddingTop: i ? 14 : 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ ...fieldLabel, margin: 0, color: "#1C1917" }}>Seller {i + 1}</span>
              {d.sellers.length > 1 && (
                <button
                  type="button"
                  style={button}
                  aria-label={`Remove seller ${i + 1}`}
                  onClick={() => set("sellers", d.sellers.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
            <PartyFields value={s} onChange={(v) => setSeller(i, v)} />
            <Field text="Share (%)" hint="Sellers must add up to 100. Drives the TDS split.">
              <input
                style={{ ...input, maxWidth: 160 }}
                inputMode="decimal"
                value={s.sharePct}
                onChange={(e) => setSeller(i, { ...s, sharePct: e.target.value })}
              />
            </Field>
          </div>
        ))}
      </Section>

      <Section title="Buyer">
        <PartyFields value={d.buyer} onChange={(v) => set("buyer", v)} />
      </Section>

      <Section title="Seller's bank">
        <BankFields value={d.sellerBank} onChange={(v) => set("sellerBank", v)} />
      </Section>

      <Section title="Buyer's bank">
        <BankFields value={d.buyerBank} onChange={(v) => set("buyerBank", v)} />
      </Section>

      <Section title="Who pays, and penalties">
        <div style={grid2}>
          <Field text="Stamp duty">
            <Select value={d.stampDutyPayer} options={PAYERS} onChange={(v) => set("stampDutyPayer", v)} />
          </Field>
          <Field text="Transfer fee">
            <Select value={d.transferFeePayer} options={PAYERS} onChange={(v) => set("transferFeePayer", v)} />
          </Field>
          <Field text="Dues before transfer">
            <Select value={d.pastDuesPayer} options={["BUYER", "SELLER"]} onChange={(v) => set("pastDuesPayer", v)} />
          </Field>
          <Field text="Penalty (₹)">
            <input style={input} inputMode="decimal" value={d.penaltyRupees} onChange={(e) => set("penaltyRupees", e.target.value)} />
          </Field>
          <Field text="Penalty applies to">
            <Select value={d.penaltyParty} options={["BUYER", "SELLER", "BOTH"]} onChange={(v) => set("penaltyParty", v)} />
          </Field>
          <Field text="Late self-funding (₹ / day)">
            <input
              style={input}
              inputMode="decimal"
              value={d.lateSelfFundingPenaltyPerDayRupees}
              onChange={(e) => set("lateSelfFundingPenaltyPerDayRupees", e.target.value)}
            />
          </Field>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.85rem", marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={d.bankDelayAutoExtension}
            onChange={(e) => set("bankDelayAutoExtension", e.target.checked)}
          />
          <span>
            Deadline extends automatically when a bank or builder causes the delay
            <span style={{ display: "block", fontSize: "0.7rem", color: "#78716C" }}>
              Without it, a penalty can land on a party for someone else’s delay.
            </span>
          </span>
        </label>
        <Field text="Possession notes">
          <textarea
            style={{ ...input, minHeight: 70 }}
            value={d.possessionNotes}
            onChange={(e) => set("possessionNotes", e.target.value)}
          />
        </Field>
      </Section>
    </>
  );
}
