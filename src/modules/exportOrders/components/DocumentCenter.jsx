import React, { useState, useEffect, useRef } from 'react';
import { FileText, Download, Printer, Eye, CheckCircle, Clock, Loader2, Edit2 } from 'lucide-react';
import api from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import Modal from '../../../components/Modal';
import { incotermLabel } from '../../../shared/constants/incoterms';

// ─── Document Templates ───
// Each function takes the document JSON and returns printable HTML

/**
 * Build line-item rows for any document's product table.
 *
 * Multi-line P.I.s use doc.items[]. Legacy single-product orders fall back
 * to one synthesized row from the order summary fields. Either way the
 * caller iterates the returned array.
 *
 * Each row exposes the same shape so every renderer can map over them
 * consistently:
 *   { sno, brand, productName, description, hsCode,
 *     bagSizeKg, bagType, packing, bagCount, qtyMT, pricePerMT, amount }
 */
function buildLineItems(doc) {
  const { order, items } = doc || {};
  if (!order) return [];

  const orderBagSize = parseFloat(order.bagSizeKg) || 50;
  const orderBagType = order.bagType || 'PP';
  const orderBrand = order.brandMarking || '';
  const orderQuality = order.qualityDescription || order.product || '';
  const orderMasterBag = parseFloat(order.masterBagSizeKg) || 0;

  // Returns a packing string that appends master-bag info when the
  // retail bag is small enough to require an outer.
  const composePacking = (bagSize, bagType, masterBagSize) => {
    const base = `PACKED IN ${bagSize} KG${bagSize === 1 ? '' : 'S'} ${bagType} BAG`;
    return masterBagSize > 0 ? `${base}, MASTER ${masterBagSize} KG OUTER` : base;
  };

  if (Array.isArray(items) && items.length > 0) {
    return items.map((it, idx) => {
      const qty = parseFloat(it.qtyMT) || 0;
      const price = parseFloat(it.pricePerMT) || 0;
      const bagSize = parseFloat(it.bagSizeKg) || orderBagSize;
      const bagType = it.bagType || orderBagType;
      const masterBagSize = parseFloat(it.masterBagSizeKg) || orderMasterBag || 0;
      const bagCount = parseInt(it.bagCount, 10)
        || (qty > 0 && bagSize > 0 ? Math.round((qty * 1000) / bagSize) : 0);
      const masterBagCount = masterBagSize > 0 ? Math.ceil((qty * 1000) / masterBagSize) : 0;
      const description = it.qualityDescription
        || `${it.productName || 'Rice'} max 0-${it.brokenPctTarget != null ? it.brokenPctTarget : (order.brokenPctTarget || 2)}% broken, double (silky) polished and sortexed. Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Latest crop.${it.hsCode ? `<br/><strong>HS CODE ${it.hsCode}</strong>` : ''}`;
      const packing = it.packing || composePacking(bagSize, bagType, masterBagSize);
      return {
        sno: idx + 1,
        brand: it.bagBrand || it.productName || orderBrand || '—',
        productName: it.productName || '',
        description,
        hsCode: it.hsCode || '',
        bagSizeKg: bagSize,
        bagType,
        masterBagSizeKg: masterBagSize,
        masterBagCount,
        packing,
        bagCount,
        qtyMT: qty,
        pricePerMT: price,
        amount: parseFloat(it.lineTotal) || qty * price,
      };
    });
  }

  // Single-product fallback for legacy orders.
  const totalBags = parseInt(order.totalBags, 10)
    || (order.qtyMT && orderBagSize ? Math.round((order.qtyMT * 1000) / orderBagSize) : 0);
  const masterBagCount = orderMasterBag > 0 ? Math.ceil(((parseFloat(order.qtyMT) || 0) * 1000) / orderMasterBag) : 0;
  return [{
    sno: 1,
    brand: orderBrand || '—',
    productName: order.product || '',
    description: orderQuality,
    hsCode: order.hsCode || '',
    bagSizeKg: orderBagSize,
    bagType: orderBagType,
    masterBagSizeKg: orderMasterBag,
    masterBagCount,
    packing: composePacking(orderBagSize, orderBagType, orderMasterBag),
    bagCount: totalBags,
    qtyMT: parseFloat(order.qtyMT) || 0,
    pricePerMT: parseFloat(order.pricePerMT) || 0,
    amount: parseFloat(order.contractValue) || 0,
  }];
}

// Number formatting helpers used by renderers.
const fmtMoney = (n) => (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMt = (n) => (parseFloat(n) || 0).toFixed(3);

function renderHeader(company) {
  return `
    <div style="text-align:center; margin-bottom:20px; border-bottom:2px solid #1e3a5f; padding-bottom:15px;">
      <h1 style="font-size:24px; font-weight:bold; color:#1e3a5f; margin:0;">AGRI COMMODITIES</h1>
      <p style="font-style:italic; color:#666; margin:4px 0;">${company.tagline}</p>
    </div>`;
}

function renderCompanyFooter(company) {
  return `
    <div style="text-align:center; margin-top:30px; padding-top:10px; border-top:1px solid #ccc; font-size:10px; color:#666;">
      ${company.address}<br/>
      Tel: ${company.phone} &nbsp; Fax: ${company.fax} &nbsp; Email: ${company.email} &nbsp; Website: ${company.website}
    </div>`;
}

function renderProformaInvoice(doc) {
  const { company, buyer, order, shipment } = doc;
  const lines = buildLineItems(doc);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalAmt = lines.reduce((s, l) => s + (l.amount || 0), 0);
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; width:100%; max-width:1040px; margin:0 auto; padding:16px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:16px; margin:10px 0;">PROFORMA INVOICE</h2>

      <table style="width:100%; margin-bottom:15px;">
        <tr>
          <td style="vertical-align:top; width:55%;">
            <strong>Name & Address of Consignee:</strong><br/>
            <div style="border:1px solid #333; padding:8px; margin-top:4px;">
              ${buyer.name}<br/>${buyer.address}<br/>${buyer.country}
              ${buyer.vatNumber ? `<br/>VAT Number: ${buyer.vatNumber}` : ''}
            </div>
            <div style="margin-top:10px;">
              <strong>Seller's Bank Detail:</strong><br/>
              A/C Title: ${company.name},<br/>
              ${company.bank.name}, ${company.bank.branch},<br/>
              ${company.bank.city}.<br/>
              A/C # ${company.bank.account}<br/>
              SWIFT: ${company.bank.swift}<br/>
              IBAN # ${company.bank.iban}
            </div>
          </td>
          <td style="vertical-align:top; width:45%;">
            <table style="border-collapse:collapse; width:100%;">
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Date</td><td style="border:1px solid #333; padding:4px 8px;">${order.date}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Invoice No.</td><td style="border:1px solid #333; padding:4px 8px;">${order.invoiceNumber}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Contract No</td><td style="border:1px solid #333; padding:4px 8px;">${order.contractNumber}</td></tr>
            </table>
            <table style="border-collapse:collapse; width:100%; margin-top:10px;">
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Payment Terms</td><td style="border:1px solid #333; padding:4px 8px;">${order.paymentTerms}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Shipment Ports</td><td style="border:1px solid #333; padding:4px 8px;">${order.destinationPort}, ${buyer.country}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">No. of Containers</td><td style="border:1px solid #333; padding:4px 8px;">${shipment.containerCount}X${shipment.containerType === '20ft' ? "20'" : "40'"} FCL</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; margin-top:15px;">
        <thead>
          <tr style="background:#1e3a5f; color:white;">
            <th style="border:1px solid #333; padding:6px;">S.No.</th>
            <th style="border:1px solid #333; padding:6px;">Brand</th>
            <th style="border:1px solid #333; padding:6px;">Description</th>
            <th style="border:1px solid #333; padding:6px;">Packing</th>
            <th style="border:1px solid #333; padding:6px;">Bag Size<br/>(Kgs)</th>
            <th style="border:1px solid #333; padding:6px;">Bag (Qty)</th>
            <th style="border:1px solid #333; padding:6px;">Weight in MT<br/>(Approx.)</th>
            <th style="border:1px solid #333; padding:6px;">FOB<br/>Price Per MT<br/>(${order.currency})</th>
            <th style="border:1px solid #333; padding:6px;">Total Amount<br/>(${order.currency})</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.sno}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center; font-weight:bold; color:#d4a017;">${l.brand}</td>
              <td style="border:1px solid #333; padding:6px;">${l.description}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.packing || '—'}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.bagSizeKg}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${(l.bagCount || 0).toLocaleString()}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${fmtMt(l.qtyMT)}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${fmtMoney(l.pricePerMT)}</td>
              <td style="border:1px solid #333; padding:6px; text-align:right;">${fmtMoney(l.amount)}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold;">
            <td colspan="5" style="border:1px solid #333; padding:6px; text-align:center;">Total</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${totalBags.toLocaleString()}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${totalQty.toFixed(2)}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${order.currency}</td>
            <td style="border:1px solid #333; padding:6px; text-align:right;">${fmtMoney(totalAmt)}</td>
          </tr>
        </tbody>
      </table>

      <p style="margin-top:10px; font-style:italic; font-size:11px;">
        <em>Certification: Goods shipped under this Proforma Invoice are of Pakistan Origin.</em>
      </p>

      <div style="margin-top:30px; display:flex; justify-content:space-between;">
        <div>
          <div style="border-top:1px solid #333; width:200px; margin-top:40px; padding-top:4px; text-align:center;">
            ${company.name}<br/>Proprietor
          </div>
        </div>
        <div>
          <div style="border-top:1px solid #333; width:200px; margin-top:40px; padding-top:4px; text-align:center;">
            ${buyer.name}
          </div>
        </div>
      </div>

      ${renderCompanyFooter(company)}
    </div>`;
}

function renderCommercialInvoice(doc) {
  const { company, buyer, order, shipment, containers, totals } = doc;
  const lines = buildLineItems(doc);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0) || (totals && totals.totalBags) || order.totalBags || 0;
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalAmt = lines.reduce((s, l) => s + (l.amount || 0), 0);
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <h2 style="font-size:16px; margin:0;">COMMERCIAL INVOICE</h2>
        <span style="font-size:11px;">REX # ${company.rexNumber}</span>
      </div>

      <table style="width:100%; margin:15px 0;">
        <tr>
          <td style="vertical-align:top; width:55%;">
            <strong>Name & Address of Consignee:</strong><br/>
            <div style="border:1px solid #333; padding:8px; margin-top:4px;">
              ${buyer.name}<br/>${buyer.address}<br/>${buyer.country}
              ${buyer.vatNumber ? `<br/>VAT #: ${buyer.vatNumber}` : ''}
              ${buyer.email ? `<br/>Email: ${buyer.email}` : ''}
            </div>
          </td>
          <td style="vertical-align:top; width:45%;">
            <table style="border-collapse:collapse; width:100%;">
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">INVOICE NO:</td><td style="border:1px solid #333; padding:4px 8px;">${order.invoiceNumber}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">CONTRACT No.</td><td style="border:1px solid #333; padding:4px 8px;">${order.contractNumber}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">INVOICE DT:</td><td style="border:1px solid #333; padding:4px 8px;">${order.date}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <tr>
          <td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Shipment Ports</td>
          <td style="border:1px solid #333; padding:4px 8px;">${order.portOfLoading} to ${order.destinationPort}, ${buyer.country}</td>
          <td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">F.I. #</td>
          <td style="border:1px solid #333; padding:4px 8px;">${[shipment.fiNumber, shipment.fiNumber2, shipment.fiNumber3].filter(Boolean).join('<br/>') || '—'}</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">No. of Containers</td>
          <td style="border:1px solid #333; padding:4px 8px;">${shipment.containerCount} X ${shipment.containerType === '20ft' ? "20'" : "40'"} Fcl</td>
          <td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">F.I. Date</td>
          <td style="border:1px solid #333; padding:4px 8px;">${shipment.fiDate || '—'}</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Shipped by Sea as</td>
          <td style="border:1px solid #333; padding:4px 8px;">${shipment.vesselName || '—'}</td>
          <td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">Payment Term</td>
          <td style="border:1px solid #333; padding:4px 8px;">${order.paymentTerms}</td>
        </tr>
        ${shipment.blNumber ? `<tr>
          <td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">BL #</td>
          <td style="border:1px solid #333; padding:4px 8px;">${shipment.blNumber}</td>
          <td style="border:1px solid #333; padding:4px 8px; font-weight:bold;">BL Date</td>
          <td style="border:1px solid #333; padding:4px 8px;">${shipment.blDate || '—'}</td>
        </tr>` : ''}
      </table>

      <table style="width:100%; border-collapse:collapse; margin-top:15px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="border:1px solid #333; padding:8px;">MARKS & NOS.</th>
            <th style="border:1px solid #333; padding:8px;">QUANTITY</th>
            <th style="border:1px solid #333; padding:8px;">DESCRIPTION</th>
            <th style="border:1px solid #333; padding:8px;">UNIT PRICE<br/>FOB (${order.currency})</th>
            <th style="border:1px solid #333; padding:8px;">AMOUNT (${order.currency})</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:8px; text-align:center; font-weight:bold; font-style:italic; color:#d4a017;">${l.brand}</td>
              <td style="border:1px solid #333; padding:8px; text-align:center;">${(l.bagCount || 0).toLocaleString()} Bags<br/><br/>${fmtMt(l.qtyMT)}<br/><br/>MT</td>
              <td style="border:1px solid #333; padding:8px;">${l.description}</td>
              <td style="border:1px solid #333; padding:8px; text-align:center;">${fmtMoney(l.pricePerMT)}</td>
              <td style="border:1px solid #333; padding:8px; text-align:right;">${fmtMoney(l.amount)}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold;">
            <td colspan="4" style="border:1px solid #333; padding:8px; text-align:right;">Total</td>
            <td style="border:1px solid #333; padding:8px; text-align:right;">${fmtMoney(totalAmt)}</td>
          </tr>
        </tbody>
      </table>

      ${containers.length > 0 ? `
        <div style="margin-top:15px; font-size:11px;">
          <p>Container # ${containers.map(c => c.containerNo).filter(Boolean).join(', ')}</p>
          <p>TOTAL BAGS: ${totalBags.toLocaleString()}</p>
          <p>GROSS WEIGHT: ${(totals.grossWeightMT || order.qtyMT).toFixed(3)} MT</p>
          <p>NET WEIGHT: ${(totals.netWeightMT || order.qtyMT).toFixed(3)} MT</p>
        </div>
      ` : ''}

      <p style="font-style:italic; font-size:11px; margin-top:10px;">
        <em>Certification: Goods shipped under this invoice are from Pakistan origin</em>
      </p>

      <div style="margin-top:40px; text-align:right;">
        <p>Name of Signing authority:</p>
        <p style="font-weight:bold;">${company.proprietor}<br/>Proprietor</p>
        <p style="font-weight:bold;">${company.name}</p>
      </div>

      ${renderCompanyFooter(company)}
    </div>`;
}

function renderPackingList(doc) {
  const { company, buyer, order, shipment, containers, totals, items } = doc;

  // Format helpers
  const fmtKg = (n) => (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMT = (kg) => ((parseFloat(kg) || 0) / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  // Build the row source. Multi-line P.I.s use items[]; otherwise fall back
  // to a single synthesized row from the order's summary fields so legacy
  // single-product orders still render.
  const rows = (items && items.length > 0)
    ? items.map((it) => {
        const bagSize = it.bagSizeKg || order.bagSizeKg || 50;
        const bagType = it.bagType || order.bagType || 'PP';
        const masterBagSize = parseFloat(it.masterBagSizeKg) || parseFloat(order.masterBagSizeKg) || 0;
        const bagCount = it.bagCount || (it.qtyMT && bagSize ? Math.round((it.qtyMT * 1000) / bagSize) : 0);
        const masterBagCount = masterBagSize > 0 ? Math.ceil((it.qtyMT * 1000) / masterBagSize) : 0;
        const grossKg = it.qtyMT * 1000;
        const defaultTareGm = bagSize >= 50 ? 90 : bagSize >= 25 ? 50 : bagSize >= 10 ? 30 : 20;
        const tarePerBagKg = (order.bagWeightGm || defaultTareGm) / 1000;
        const netKg = grossKg + bagCount * tarePerBagKg;
        const description = it.qualityDescription
          || `${it.productName || order.product || 'Rice'} max 0-${it.brokenPctTarget != null ? it.brokenPctTarget : (order.brokenPctTarget || 2)}% broken, double (silky) polished and sortexed. Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Product to meet EU regulations at all times. Latest crop.${it.hsCode ? `<br/><strong>HS CODE ${it.hsCode}</strong>` : ''}`;
        const packingBase = it.packing || `PACKED IN ${bagSize} KGS ${bagType} BAG`;
        const packing = masterBagSize > 0
          ? `${packingBase}<br/><span style="color:#92400e">Master pack: ${masterBagCount.toLocaleString()} × ${masterBagSize} KG outer (${Math.floor(masterBagSize / bagSize)} retail bags per master)</span>`
          : packingBase;
        const quantity = masterBagSize > 0
          ? `${bagCount.toLocaleString()} retail bags<br/>${masterBagCount.toLocaleString()} master bags`
          : `${bagCount.toLocaleString()} Bags`;
        return {
          label: (it.productName || order.product || '').toUpperCase(),
          description,
          packing,
          quantity,
          grossKg,
          netKg,
          bagCount,
          masterBagCount,
        };
      })
    : (() => {
        const bagSize = order.bagSizeKg || 50;
        const bagType = order.bagType || 'PP';
        const masterBagSize = parseFloat(order.masterBagSizeKg) || 0;
        const totalBags = order.totalBags || (order.qtyMT && bagSize ? Math.round((order.qtyMT * 1000) / bagSize) : 0);
        const masterBagCount = masterBagSize > 0 ? Math.ceil(((parseFloat(order.qtyMT) || 0) * 1000) / masterBagSize) : 0;
        const grossKg = (totals && totals.grossWeightMT ? totals.grossWeightMT : order.qtyMT) * 1000;
        const defaultTareGm = bagSize >= 50 ? 90 : bagSize >= 25 ? 50 : bagSize >= 10 ? 30 : 20;
        const tarePerBagKg = (order.bagWeightGm || defaultTareGm) / 1000;
        const netKg = (totals && totals.netWeightMT)
          ? totals.netWeightMT * 1000
          : grossKg + totalBags * tarePerBagKg;
        const packingBase = `PACKED IN ${bagSize} KGS ${bagType} BAG`;
        const packing = masterBagSize > 0
          ? `${packingBase}<br/><span style="color:#92400e">Master pack: ${masterBagCount.toLocaleString()} × ${masterBagSize} KG outer (${Math.floor(masterBagSize / bagSize)} retail bags per master)</span>`
          : packingBase;
        const quantity = masterBagSize > 0
          ? `${totalBags.toLocaleString()} retail bags<br/>${masterBagCount.toLocaleString()} master bags`
          : `${totalBags.toLocaleString()} Bags`;
        return [{
          label: (order.brandMarking || order.product || '').toUpperCase(),
          description: order.qualityDescription || order.product || '',
          packing,
          quantity,
          grossKg,
          netKg,
          bagCount: totalBags,
          masterBagCount,
        }];
      })();

  const totalBags = rows.reduce((s, r) => s + (r.bagCount || 0), 0);
  const totalGrossKg = rows.reduce((s, r) => s + (r.grossKg || 0), 0);
  const totalNetKg = rows.reduce((s, r) => s + (r.netKg || 0), 0);
  const containerCount = containers && containers.length > 0
    ? `${String(containers.length).padStart(2, '0')} X 20' Fcl`
    : (shipment && shipment.containerCount ? `${String(shipment.containerCount).padStart(2, '0')} X 20' Fcl` : '');

  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:820px; margin:0 auto; padding:20px;">
      <h2 style="text-align:center; font-size:18px; margin:10px 0 18px; letter-spacing:1px;">PACKING LIST</h2>

      <table style="width:100%; margin:0 0 12px; border-collapse:collapse;">
        <tr>
          <td style="vertical-align:top; width:55%; padding-right:10px;">
            <div style="border:1px solid #333; padding:10px; min-height:80px;">
              <strong style="text-transform:uppercase;">${buyer.name || ''}</strong><br/>
              ${(buyer.address || '').replace(/\n/g, '<br/>')}
              ${buyer.country ? `<br/>${buyer.country}` : ''}
            </div>
          </td>
          <td style="vertical-align:top; width:45%;">
            <table style="border-collapse:collapse; width:100%;">
              <tr><td style="border:1px solid #333; padding:5px 8px; font-weight:bold; width:42%;">INVOICE NO:</td><td style="border:1px solid #333; padding:5px 8px;">${order.invoiceNumber || ''}</td></tr>
              <tr><td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">CONTRACT No.</td><td style="border:1px solid #333; padding:5px 8px;">${order.contractNumber || ''}</td></tr>
              <tr><td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">INVOICE DT:</td><td style="border:1px solid #333; padding:5px 8px;">${order.date || ''}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:15px;">
        <tr>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold; width:18%;">Shipment Ports</td>
          <td style="border:1px solid #333; padding:5px 8px; width:32%;">${order.portOfLoading || ''}${buyer.country ? `, ${buyer.country}` : ''}</td>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold; width:18%;">F.I #</td>
          <td style="border:1px solid #333; padding:5px 8px; width:32%;">${shipment.fiNumber || ''}</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">No. of Container</td>
          <td style="border:1px solid #333; padding:5px 8px;">${containerCount}</td>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">F.I Date</td>
          <td style="border:1px solid #333; padding:5px 8px;">${shipment.fiDate || ''}</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">Shipped by Sea</td>
          <td style="border:1px solid #333; padding:5px 8px;">${shipment.vesselName || ''}${shipment.voyageNumber ? ` / ${shipment.voyageNumber}` : ''}</td>
          <td style="border:1px solid #333; padding:5px 8px; font-weight:bold;">Payment Terms</td>
          <td style="border:1px solid #333; padding:5px 8px;">${order.paymentTerms || ''}</td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="border:1px solid #333; padding:6px;">Container No.</th>
            <th style="border:1px solid #333; padding:6px;">DESCRIPTION</th>
            <th style="border:1px solid #333; padding:6px;">PACKING</th>
            <th style="border:1px solid #333; padding:6px;">QUANTITY</th>
            <th style="border:1px solid #333; padding:6px;" colspan="2">WEIGHT (IN KGS)<br/><span style="font-weight:normal; font-size:10px;">Gross &nbsp;|&nbsp; Net</span></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; font-weight:bold; font-style:italic; text-align:center;">${r.label}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; font-size:10.5px; line-height:1.4;">${r.description}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; text-align:center;">${r.packing}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; text-align:center;">${r.quantity}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; text-align:right;">${fmtKg(r.grossKg)}</td>
              <td style="border:1px solid #333; padding:8px; vertical-align:top; text-align:right;">${fmtKg(r.netKg)}</td>
            </tr>
          `).join('')}
          <tr>
            <td colspan="3" rowspan="3" style="border:1px solid #333; padding:8px; vertical-align:top;">
              <div style="font-weight:bold;">TOTAL BAGS &nbsp;:&nbsp; ${totalBags.toLocaleString()} Bags</div>
              <div style="font-weight:bold; margin-top:4px;">GROSS WEIGHT &nbsp;:&nbsp; ${fmtMT(totalGrossKg)} MTS</div>
              <div style="font-weight:bold;">NET WEIGHT &nbsp;:&nbsp; ${fmtMT(totalNetKg)} MTS</div>
            </td>
            <td style="border:1px solid #333; padding:8px; text-align:center; font-weight:bold;" rowspan="3">Total</td>
            <td style="border:1px solid #333; padding:8px; text-align:right; font-weight:bold;" rowspan="3">${fmtKg(totalGrossKg)}</td>
            <td style="border:1px solid #333; padding:8px; text-align:right; font-weight:bold;" rowspan="3">${fmtKg(totalNetKg)}</td>
          </tr>
          <tr></tr>
          <tr></tr>
        </tbody>
      </table>

      <p style="font-style:italic; font-size:11px; margin-top:18px; text-decoration:underline;">
        Certification: Goods are shipped from Pakistan origin
      </p>

      ${renderCompanyFooter(company)}
    </div>`;
}

function renderGenericDocument(doc) {
  const { company, buyer, order, shipment, containers } = doc;
  const lines = buildLineItems(doc);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  const distinctHs = [...new Set(lines.map((l) => l.hsCode).filter(Boolean))];
  const isMulti = lines.length > 1;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:16px; margin:10px 0;">${doc.type.toUpperCase()}</h2>
      <table style="width:100%; font-size:12px; margin:15px 0;">
        <tr><td style="padding:4px 0; font-weight:bold; width:160px;">Buyer:</td><td>${buyer.name}, ${buyer.country}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Contract No:</td><td>${order.contractNumber}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold; vertical-align:top;">Product${isMulti ? 's' : ''}:</td><td>${
          isMulti
            ? `<ul style="margin:0; padding-left:18px;">${lines.map((l) => `<li>${l.productName} — ${fmtMt(l.qtyMT)} MT @ ${order.currency} ${fmtMoney(l.pricePerMT)}/MT${l.hsCode ? ` · HS ${l.hsCode}` : ''}</li>`).join('')}</ul>`
            : `${lines[0]?.productName || order.product || '—'}`
        }</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Quantity:</td><td>${totalQty.toFixed(3)} MT (${totalBags.toLocaleString()} bags)</td></tr>
        ${!isMulti && lines[0] ? `<tr><td style="padding:4px 0; font-weight:bold;">Price:</td><td>${order.currency} ${fmtMoney(lines[0].pricePerMT)} per MT ${order.incoterm}</td></tr>` : ''}
        <tr><td style="padding:4px 0; font-weight:bold;">Total:</td><td>${order.currency} ${fmtMoney(order.contractValue)}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">HS Code${distinctHs.length > 1 ? 's' : ''}:</td><td>${distinctHs.length > 0 ? distinctHs.join(', ') : (order.hsCode || '—')}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Payment Terms:</td><td>${order.paymentTerms}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Port of Loading:</td><td>${order.portOfLoading}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Destination:</td><td>${order.destinationPort}, ${buyer.country}</td></tr>
        ${shipment.vesselName ? `<tr><td style="padding:4px 0; font-weight:bold;">Vessel:</td><td>${shipment.vesselName}</td></tr>` : ''}
        ${shipment.blNumber ? `<tr><td style="padding:4px 0; font-weight:bold;">BL Number:</td><td>${shipment.blNumber}</td></tr>` : ''}
        ${shipment.fiNumber ? `<tr><td style="padding:4px 0; font-weight:bold;">F.I. Number:</td><td>${shipment.fiNumber}</td></tr>` : ''}
      </table>
      ${!isMulti ? `<p style="margin-top:10px;"><strong>Quality:</strong><br/>${order.qualityDescription || lines[0]?.description || ''}</p>` : ''}
      ${containers.length > 0 ? `
        <h3 style="margin-top:15px;">Containers</h3>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="background:#f5f5f5;">
            <th style="border:1px solid #ccc; padding:4px;">#</th>
            <th style="border:1px solid #ccc; padding:4px;">Container No</th>
            <th style="border:1px solid #ccc; padding:4px;">Lot No</th>
            <th style="border:1px solid #ccc; padding:4px;">Bags</th>
            <th style="border:1px solid #ccc; padding:4px;">Net (kg)</th>
            <th style="border:1px solid #ccc; padding:4px;">Gross (kg)</th>
          </tr></thead>
          <tbody>
            ${containers.map(c => `<tr>
              <td style="border:1px solid #ccc; padding:4px; text-align:center;">${c.sequenceNo}</td>
              <td style="border:1px solid #ccc; padding:4px;">${c.containerNo || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; font-size:10px;">${c.lotNumber || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; text-align:center;">${c.bagsCount || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; text-align:right;">${c.netWeightKg || '—'}</td>
              <td style="border:1px solid #ccc; padding:4px; text-align:right;">${c.grossWeightKg || '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : ''}

      ${doc.specific?.originDeclaration ? `
        <div style="margin-top:20px; padding:10px; border:1px solid #333; font-size:11px;">
          <strong>TEXT FOR STATEMENT OF ORIGIN</strong><br/><br/>
          ${doc.specific.originDeclaration}
        </div>
      ` : ''}

      <div style="margin-top:50px; text-align:right;">
        <p style="font-weight:bold;">${company.name}<br/>${company.proprietor}<br/>Proprietor</p>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Sales Contract ───
function renderSalesContract(doc) {
  const { company, buyer, order, shipment, packing } = doc;
  const lines = buildLineItems(doc);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalAmt = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const isMulti = lines.length > 1;

  // Per-line description block — bullet list when multi-line, single
  // paragraph when there's only one item to keep the legacy look intact.
  const productHtml = isMulti
    ? `<ul style="margin:0; padding-left:20px;">${lines.map((l) => `
          <li style="margin-bottom:6px;">
            <strong>${l.productName || `Item ${l.sno}`}</strong> — ${fmtMt(l.qtyMT)} MT @ ${order.currency} ${fmtMoney(l.pricePerMT)}/MT · packed in ${l.bagSizeKg} kg ${l.bagType} bags${l.hsCode ? ` · HS code <strong>${l.hsCode}</strong>` : ''}
          </li>`).join('')}</ul>
        <p style="margin-top:8px; font-size:11px; color:#555;">Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Latest crop.</p>`
    : `${lines[0]?.description || ''}<br/>Packed in ${lines[0]?.bagSizeKg || order.bagSizeKg || 50} kg Strong PP bags. Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Latest crop.`;

  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:18px; font-style:italic; margin:10px 0;">Sales Contract</h2>

      <table style="width:100%; font-size:12px; line-height:1.8;">
        <tr><td style="width:130px; font-weight:bold; vertical-align:top;">Date:</td><td>${order.date}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Contract #</td><td>${order.contractNumber || order.orderNo}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Buyer:</td><td>${buyer.name}<br/>${buyer.address}<br/>${buyer.country}${buyer.vatNumber ? `<br/>VAT: ${buyer.vatNumber}` : ''}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Seller:</td><td>${company.name}<br/>${company.address}</td></tr>
        <tr><td style="font-weight:bold;">Quantity:</td><td>About ${totalQty.toFixed(3)} M/Tons net weight${isMulti ? ` (across ${lines.length} products)` : ''}.</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Product${isMulti ? 's' : ''}:</td><td>${productHtml}</td></tr>
        <tr><td style="font-weight:bold;">Quality:</td><td>Aflatoxins, Ochratoxins, Heavy metal and Pesticide residues are in line with EU law.</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Price:</td><td>${isMulti
          ? `Per-line rates as above. Incoterm ${order.incoterm} ${order.portOfLoading || 'Karachi'}, Pakistan.`
          : `@ ${order.currency} ${fmtMoney(lines[0]?.pricePerMT || order.pricePerMT)} per metric ton ${order.incoterm} ${order.portOfLoading || 'Karachi'}, Pakistan`}</td></tr>
        <tr><td style="font-weight:bold;">Total Amount:</td><td>${order.currency} ${fmtMoney(totalAmt)}</td></tr>
        <tr><td style="font-weight:bold;">Shipment:</td><td>${packing?.shipmentWindowStart || '—'} - ${packing?.shipmentWindowEnd || '—'}</td></tr>
        <tr><td style="font-weight:bold;">Payment:</td><td>${order.paymentTerms}</td></tr>
      </table>

      <div style="margin-top:15px;">
        <strong>Documents:</strong>
        <ul style="font-size:11px; line-height:1.8; margin-top:5px;">
          <li>Original full set of documents to be couriered to buyer's bank as soon as they are issued.</li>
          <li>Full set clean board Bill of Lading. Consignee 'to order'. Blank endorsed, marked 'Freight Collect'.</li>
          <li>Signed Commercial Invoice (Attested by Karachi Chamber of Commerce)</li>
          <li>Packing list (Attested by Karachi Chamber of Commerce)</li>
          <li>Fumigation certificate</li>
          <li>Phytosanitary Certificate issued and signed by the Department of Plant Protection</li>
          <li>Statement of origin, issued by shipper under Rex system</li>
          <li>Non-GMO certificate, issued by the Department of Plant Protection, Govt. of Pakistan</li>
        </ul>
      </div>

      <p style="margin-top:15px; font-size:11px;">This contract shall be signed by the buyer and returned. Failure to do so and buyer's retention of the contract shall constitute in acceptance of terms and conditions hereof.</p>

      <div style="margin-top:40px; display:flex; justify-content:space-between;">
        <div style="text-align:center; width:200px;">
          <div style="border-top:1px solid #333; padding-top:8px;">${company.name}</div>
        </div>
        <div style="text-align:center; width:200px;">
          <div style="border-top:1px solid #333; padding-top:8px;">${buyer.name}</div>
        </div>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Production Plan ───
function renderProductionPlan(doc) {
  const { company, buyer, order, containers, packing } = doc;
  const lines = buildLineItems(doc);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:14px; text-decoration:underline; margin:10px 0;">PRODUCTION PLAN - ${containers.length > 0 ? containers.length : '—'}X${containers[0]?.containerType === '40ft' ? '40' : '20'} FCL</h2>

      <div style="color:red; text-align:center; font-weight:bold; margin:10px 0;">
        SGS SAMPLE FOR PESTICIDE<br/>INV # ${order.invoiceNumber}
      </div>

      <table style="width:100%; font-size:11px; margin-bottom:10px;">
        <tr><td style="width:120px;">DATE:</td><td>${order.date}</td></tr>
        <tr><td>PARTY NAME.</td><td>${buyer.name}</td></tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="border:1px solid #333; padding:6px;">Container #</th>
            <th style="border:1px solid #333; padding:6px;">BRAND</th>
            <th style="border:1px solid #333; padding:6px;">DESCRIPTION</th>
            <th style="border:1px solid #333; padding:6px;">BROKEN %</th>
            <th style="border:1px solid #333; padding:6px;">TOTAL QTY IN MT</th>
            <th style="border:1px solid #333; padding:6px;">PACKING / MASTER BAGS</th>
            <th style="border:1px solid #333; padding:6px;">NO OF BAGS</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.sno}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.brand}</td>
              <td style="border:1px solid #333; padding:6px;">${l.description}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${order.brokenPctTarget || '—'}%</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${fmtMt(l.qtyMT)}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${l.packing}</td>
              <td style="border:1px solid #333; padding:6px; text-align:center;">${(l.bagCount || 0).toLocaleString()}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold;">
            <td colspan="4" style="border:1px solid #333; padding:6px; text-align:right;">Total</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${totalQty.toFixed(3)}</td>
            <td style="border:1px solid #333; padding:6px;"></td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${totalBags.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      ${containers.length > 0 ? `
        <p style="color:green; font-size:11px; margin-top:10px;">
          ${containers.map((c, i) => `CONTAINER # ${i + 1} : LOT NUMBER : ${c.lotNumber || `RM/${String(i + 1).padStart(2, '0')}/${new Date().getFullYear()}`}`).join(', ')}
        </p>
      ` : ''}

      <div style="margin-top:15px;">
        <strong style="text-decoration:underline;">REMARKS.</strong>
        <ol style="font-size:11px; line-height:2;">
          <li>SILKY POLISHED</li>
          <li>BROKEN PERCENTAGE CONFIRM WITH AAP.</li>
          <li><u>PLS. COUNT EMPTY BAGS BEFORE START OF PRODUCTION TO AVOID SHORTAGE.</u></li>
          <li>PLS. ENSURE THAT HEAP NO AND PRODUCTION AND EXPIRY DATES ARE APPROPRIATE.</li>
          <li>PLS. ENSURE THAT THE CONTAINERS ARE SUPER CLEAN. ALSO SPREAD POLYTHENE SHEETS BEFORE LOADING THE BAGS.</li>
          <li>ANY OTHER DETAIL PLS. CONFIRM.</li>
          ${packing?.productionRemarks ? `<li>${packing.productionRemarks}</li>` : ''}
        </ol>
      </div>

      ${containers.length > 0 ? `
        <div style="margin-top:20px; display:grid; grid-template-columns:1fr 1fr; gap:15px;">
          ${containers.map((c, i) => `
            <div style="border:1px solid #333; padding:12px; font-size:11px;">
              <h4 style="text-align:center; font-weight:bold; margin:0 0 8px 0;">${lines.map((l) => l.productName).filter(Boolean).join(' / ') || order.product || 'BASMATI WHITE RICE'}</h4>
              <table style="width:100%;">
                <tr><td style="font-weight:bold; width:55%;">WEIGHT</td><td>: ${order.bagSizeKg || 50}KG</td></tr>
                <tr><td style="font-weight:bold;">COUNTRY OF ORIGIN</td><td>: PAKISTAN</td></tr>
                <tr><td style="font-weight:bold;">DATE OF PRODUCTION</td><td>: ${packing?.productionDate || '—'}</td></tr>
                <tr><td style="font-weight:bold;">DATE OF EXPIRY</td><td>: ${packing?.expiryDate || '—'}</td></tr>
                <tr><td style="font-weight:bold;">BATCH NUMBER</td><td>: ${c.lotNumber || `RM/${String(i + 1).padStart(2, '0')}/${new Date().getFullYear()}`}</td></tr>
              </table>
              <p style="text-align:center; margin-top:8px; font-size:10px;">PRODUCT OF PAKISTAN</p>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;
}

// ─── Bank FI Request (E-Form) ───
function renderBankFIRequest(doc) {
  const { company, buyer, order, shipment } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h3 style="text-align:center; font-size:13px; margin:10px 0;">REQUEST FOR GENERATION OF FINANCIAL INSTRUMENT<br/>(FOR EXPORT TRANSACTION)</h3>

      <div style="text-align:right; margin-bottom:15px;"><strong>DATE</strong> &nbsp; ${order.date}</div>

      <table style="width:100%; font-size:12px; margin-bottom:15px;">
        <tr><td style="width:140px; font-weight:bold;">Name of Company</td><td style="text-align:center; border-bottom:1px solid #333;">${company.name}</td></tr>
        <tr><td style="font-weight:bold;">NTN</td><td style="text-align:center; border-bottom:1px solid #333;">${company.ntn}</td></tr>
        <tr><td style="font-weight:bold;">IBAN</td><td style="text-align:center; border-bottom:1px solid #333;">${company.bank.iban}</td></tr>
      </table>

      <p style="font-size:11px;">We, hereby request ${company.bank.name} to issue Financial Instrument (hereinafter called "FI"), as below</p>

      <table style="width:100%; font-size:11px; margin:15px 0; line-height:1.8;">
        <tr><td style="width:140px; font-weight:bold;">Mode of Payment</td><td>Contract/Collection</td></tr>
        <tr><td style="font-weight:bold;">Consignee Name</td><td>${buyer.name}</td></tr>
        <tr><td style="font-weight:bold;">Consignee Address</td><td>${buyer.address || buyer.country}</td></tr>
        <tr><td style="font-weight:bold;">Consignee Country</td><td>${buyer.country}</td></tr>
        <tr><td style="font-weight:bold;">Port of Discharge</td><td>${order.destinationPort || '—'}</td></tr>
        <tr><td style="font-weight:bold;">Delivery Terms</td><td>${incotermLabel(order.incoterm)}</td></tr>
      </table>

      <table style="width:70%; border-collapse:collapse; margin:15px 0;">
        <tr>
          <td style="border:1px solid #333; padding:6px; font-weight:bold;">CURRENCY</td>
          <td style="border:1px solid #333; padding:6px; font-weight:bold;">AMOUNT</td>
          <td style="border:1px solid #333; padding:6px; font-weight:bold;">EXPIRY DATE</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:6px;">${order.currency}</td>
          <td style="border:1px solid #333; padding:6px;">${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
          <td style="border:1px solid #333; padding:6px;"></td>
        </tr>
      </table>

      <h4 style="margin-top:15px;">DETAILS OF LC / CONTRACT / ADVANCE PAYMENT</h4>
      <table style="border-collapse:collapse; width:50%; font-size:11px;">
        <tr><td style="border:1px solid #333; padding:4px;">TOTAL VALUE</td><td style="border:1px solid #333; padding:4px;">${order.currency} ${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
        <tr><td style="border:1px solid #333; padding:4px;">CURRENT REQUEST</td><td style="border:1px solid #333; padding:4px;">${order.currency} ${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
      </table>

      <h4 style="margin-top:15px;">GOODS DETAILS</h4>
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="border:1px solid #333; padding:6px;">HS CODE</th>
          <th style="border:1px solid #333; padding:6px;">GOODS DESCRIPTION</th>
          <th style="border:1px solid #333; padding:6px;">QTY</th>
          <th style="border:1px solid #333; padding:6px;">UNIT</th>
          <th style="border:1px solid #333; padding:6px;">ORIGIN</th>
          <th style="border:1px solid #333; padding:6px;">UNIT PRICE</th>
        </tr></thead>
        <tbody>
          ${buildLineItems(doc).map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:6px;">${l.hsCode || '—'}</td>
              <td style="border:1px solid #333; padding:6px;">${l.productName}</td>
              <td style="border:1px solid #333; padding:6px;">${fmtMt(l.qtyMT)}</td>
              <td style="border:1px solid #333; padding:6px;">MT</td>
              <td style="border:1px solid #333; padding:6px;">PAKISTAN</td>
              <td style="border:1px solid #333; padding:6px;">${order.currency} ${fmtMoney(l.pricePerMT)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="margin-top:20px; font-size:9px; line-height:1.6; color:#444;">
        Declaration to be furnished by exporters pursuant to section 12(1) of the Foreign Exchange Regulation Act, 1947 read with government notifications. Documents covering the goods in the Financial Instrument including full set of bills of lading must be passed through an Authorised Dealer in Foreign Exchange.
      </div>

      <div style="margin-top:40px; text-align:right;">
        <p style="font-weight:bold;">${company.name}<br/>Proprietor</p>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Export Undertaking ───
function renderExportUndertaking(doc) {
  const { company, buyer, order } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <p>The Manager<br/>${company.bank.name} - ${company.bank.branch},<br/>Karachi.</p>
      <p>Dear Sir,</p>
      <h3 style="text-align:center; text-decoration:underline; margin:15px 0;">EXPORT UNDERTAKING</h3>

      <p>The said export transaction relates to sale of ${(() => {
        const lines = buildLineItems(doc);
        const productList = lines.length > 1
          ? lines.map((l) => `<u>${l.productName || `Item ${l.sno}`}</u>`).join(', ')
          : `<u>${(lines[0] && lines[0].productName) || order.product || '—'}</u>`;
        return productList;
      })()} for a value of <u>${order.currency} ${order.contractValue.toLocaleString()}</u> with our client <u>${buyer.name}, ${buyer.country}</u> as per mutually agreed contract / Proforma Invoice No. <u>${order.invoiceNumber}</u> dated <u>${order.date}</u> with payment term <u>${order.paymentTerms}</u>.</p>

      <p>We are very much satisfied with the credentials, sound financial standing and good repute of our client (the importer/foreign buyer/consignee) and confirm their bona fide.</p>

      <p>I / We further confirm that:</p>
      <ol style="line-height:2; font-size:11px;">
        <li>The merchandise being exported falls under HS Code Number(s): <u>${(() => {
          const codes = [...new Set(buildLineItems(doc).map((l) => l.hsCode).filter(Boolean))];
          return codes.length > 0 ? codes.join(', ') : (order.hsCode || '—');
        })()}</u>, is freely exportable / not subject to export license / does not contravene any of the provision of the aforesaid rules and regulations.</li>
        <li>We are commercial exporter / registered as an Industrial Unit with Trade Development Authority of Pakistan and hold valid export registration (GST Certificate) and membership of a recognized trade association.</li>
        <li>We are fully aware and suitably conversant with all the valid and applicable rules and regulations governing exports from Pakistan.</li>
        <li>We shall ensure to timely submit to you all the required shipping documents for onward dispatch to concerned foreign bank or submission to State bank of Pakistan.</li>
        <li>We are familiar with the list of sanctioned countries / entities with which trade transactions / dealings in any manner either directly or indirectly are proscribed.</li>
        <li>We will never involve ourselves in any trade transaction of banned items as per Negative List of the Government of Pakistan.</li>
        <li>We confirm that the contracted price of the exported goods is in line with the current International market price without any significant variance.</li>
        <li>We confirm that Origin of goods are Pakistani.</li>
        <li>We will not affect any shipment through any shipping company which itself is sanctioned or operates under the flag of any sanctioned country.</li>
        <li>We confirm that the port of discharge of goods is <u>${order.destinationPort}, ${buyer.country}</u> as mentioned on the Master Bill of Lading / Shipping Documents.</li>
      </ol>

      <p style="margin-top:20px;">Yours faithfully,</p>
      <div style="margin-top:30px;">
        <p style="font-weight:bold;">${company.name}<br/>Proprietor</p>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Simple Invoice (pre-shipping) ───
function renderInvoice(doc) {
  const { company, buyer, order, totals } = doc;
  const lines = buildLineItems(doc);
  const totalBags = lines.reduce((s, l) => s + (l.bagCount || 0), 0);
  const totalQty = lines.reduce((s, l) => s + (l.qtyMT || 0), 0);
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:16px; text-decoration:underline; margin:10px 0;">INVOICE</h2>

      <table style="width:100%; margin:15px 0;">
        <tr>
          <td style="vertical-align:top; width:55%;">
            <strong>Name & Address of Consignee:</strong><br/>
            <div style="border:1px solid #333; padding:8px; margin-top:4px;">
              ${buyer.name}<br/>${buyer.country}
            </div>
          </td>
          <td style="vertical-align:top; width:45%;">
            <table style="border-collapse:collapse; width:100%;">
              <tr><td style="border:1px solid #333; padding:4px; font-weight:bold;">INVOICE NO:</td><td style="border:1px solid #333; padding:4px;">${order.invoiceNumber}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px; font-weight:bold;">CONTRACT No.</td><td style="border:1px solid #333; padding:4px;">${order.contractNumber}</td></tr>
              <tr><td style="border:1px solid #333; padding:4px; font-weight:bold;">INVOICE DT:</td><td style="border:1px solid #333; padding:4px;">${order.date}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:15px;">
        <tr>
          <td style="border:1px solid #333; padding:4px; font-weight:bold;">Shipment Port</td>
          <td style="border:1px solid #333; padding:4px;">${order.portOfLoading} to ${order.destinationPort}, ${buyer.country}</td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:4px; font-weight:bold;">Payment Term</td>
          <td style="border:1px solid #333; padding:4px;">${order.paymentTerms}</td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse;">
        <thead><tr style="background:#f5f5f5;">
          <th style="border:1px solid #333; padding:8px;">MARKS & NOS.</th>
          <th style="border:1px solid #333; padding:8px;">QUANTITY</th>
          <th style="border:1px solid #333; padding:8px;">DESCRIPTION</th>
        </tr></thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td style="border:1px solid #333; padding:12px; text-align:center; font-weight:bold; color:#d4a017;">${l.brand}</td>
              <td style="border:1px solid #333; padding:12px; text-align:center;">${(l.bagCount || 0).toLocaleString()} Bags<br/><br/>${fmtMt(l.qtyMT)} MT</td>
              <td style="border:1px solid #333; padding:12px;">${l.description}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold; background:#fafafa;">
            <td style="border:1px solid #333; padding:8px; text-align:right;" colspan="2">TOTAL</td>
            <td style="border:1px solid #333; padding:8px;">${totalBags.toLocaleString()} Bags · GROSS ${((totals?.grossWeightMT) || totalQty + 0.1).toFixed(2)} MT · NET ${totalQty.toFixed(2)} MT</td>
          </tr>
        </tbody>
      </table>

      <p style="font-style:italic; font-size:11px; margin-top:15px;">
        <em>Certification: Goods shipped under this invoice are from Pakistan origin</em>
      </p>

      <div style="margin-top:40px; text-align:right;">
        <p style="font-weight:bold;">${company.name}<br/>Proprietor</p>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Bill of Lading ───
function renderBillOfLading(doc) {
  const { company, buyer, order, shipment, containers, totals, items } = doc;

  const containerCount = (containers && containers.length > 0)
    ? containers.length
    : (shipment && shipment.containerCount ? shipment.containerCount : 0);
  const containerType = containers && containers[0]?.containerType === '40ft' ? '40' : '20';
  const totalBags = (totals && totals.totalBags) || order.totalBags || 0;

  // Multi-line P.I. items render as separate quality blocks within the
  // Description cell so each line's HS code, packing, and quality clauses
  // appear correctly. Falls back to the single-product summary text.
  const descriptionItemsHtml = (items && items.length > 0)
    ? items.map((it) => {
        const bagSize = it.bagSizeKg || order.bagSizeKg || 50;
        const bagType = it.bagType || order.bagType || 'PP';
        const bagCount = it.bagCount || (it.qtyMT && bagSize ? Math.round((it.qtyMT * 1000) / bagSize) : 0);
        const qualityText = it.qualityDescription
          || `Pakistani ${it.productName || 'Rice'} - ${it.brokenPctTarget != null ? it.brokenPctTarget : (order.brokenPctTarget || 2)}% Broken - Double (silky) polished & color sorted, Latest Crop - PACKED IN ${bagSize} KGS ${bagType} BAG${it.hsCode ? ` - HS CODE: ${it.hsCode}` : ''} - GMO FREE, FIT FOR HUMAN CONSUMPTION AT ANY STAGE, FREE FROM ALIVE AND DEAD WEEVILS/INSECTS`;
        return `<div style="margin-bottom:6px;"><strong>${(it.productName || '').toUpperCase()}</strong> — ${bagCount.toLocaleString()} bags<br/>${qualityText}${it.hsCode ? `<br/>HS code ${it.hsCode}` : ''}</div>`;
      }).join('')
    : `${order.qualityDescription || ''}${order.hsCode ? `<br/>HS code ${order.hsCode}` : ''}`;

  // Place-of-delivery / discharge: avoid leading commas when port is empty.
  const placeOfDelivery = [order.destinationPort, buyer.country].filter(Boolean).join(', ');
  const portOfDischarge = order.destinationPort || buyer.country || '';

  // Notify party — explicit notify_party_* on order beats buyer fallback.
  const np = doc.notifyParty || {};
  const notifyHtml = np.name
    ? `${np.name}<br/>${np.address || ''}${np.phone ? `<br/>TEL: ${np.phone}` : ''}${np.email ? ` EMAIL: ${np.email}` : ''}`
    : `${buyer.name || ''}<br/>${buyer.country || ''}${buyer.phone ? `<br/>TEL: ${buyer.phone}` : ''}${buyer.email ? ` EMAIL: ${buyer.email}` : ''}`;

  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:800px; margin:0 auto; padding:10px;">
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="border:2px solid #333; padding:10px; width:50%; vertical-align:top;">
            <strong>SHIPPER</strong><br/>
            ${company.name || ''}<br/>${company.address || ''}<br/>
            TEL ${company.phone || ''} FAX: ${company.fax || '—'}
          </td>
          <td style="border:2px solid #333; padding:10px; width:50%; vertical-align:top;">
            <strong style="font-size:14px;">BILL OF LADING FORMAT</strong><br/>
            FROM<br/><strong>${company.name || ''}</strong><br/>
            <strong>BOOKING NO: ${shipment.bookingNo || '—'}</strong>
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px; vertical-align:top;">
            <strong style="text-decoration:underline;">TO THE ORDER OF</strong><br/>
            ${(company.bank && company.bank.name) || ''}<br/>${(company.bank && company.bank.branch) || ''},<br/>KARACHI, PAKISTAN
            ${shipment.fiNumber ? `<br/><br/>F.I: ${shipment.fiNumber}` : ''}
          </td>
          <td style="border:2px solid #333; padding:10px; vertical-align:top;" rowspan="2">
            <strong>PLACE OF RECEIPT:</strong><br/>${order.portOfLoading || 'Karachi, Pakistan'}
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px; vertical-align:top;">
            <strong style="text-decoration:underline;">NOTIFY PARTY:</strong><br/>
            ${notifyHtml}
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px;">
            <strong>VESSEL AND VOYAGE NO:</strong><br/>${shipment.vesselName || '—'}${shipment.voyageNumber ? ' V.' + shipment.voyageNumber : ''}
          </td>
          <td style="border:2px solid #333; padding:10px;">
            <strong>PLACE OF DELIVERY</strong><br/>${placeOfDelivery || '—'}
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px;">
            <strong>PORT OF LOADING</strong><br/>${order.portOfLoading || 'Karachi, Pakistan'}
          </td>
          <td style="border:2px solid #333; padding:10px;">
            <strong>PORT OF DISCHARGE</strong><br/>${portOfDischarge || '—'}
          </td>
        </tr>
      </table>

      <table style="width:100%; border-collapse:collapse; margin-top:-1px;">
        <tr>
          <td style="border:2px solid #333; padding:10px; width:30%; vertical-align:top;">
            <strong>MARKS & Numbers</strong><br/><br/>
            <span style="font-weight:bold; color:#d4a017;">${order.brandMarking || '—'}</span>
          </td>
          <td style="border:2px solid #333; padding:10px; width:70%; vertical-align:top;">
            <strong>Description</strong><br/>
            ${containerCount} x ${containerType} Container containing ${totalBags.toLocaleString()} bags<br/>
            ${descriptionItemsHtml}
            <div style="margin-top:6px;">Sales contract # ${order.contractNumber || ''}${order.date ? ` Dated ${order.date}` : ''}</div>
            <div>Net Weight ${(((totals && totals.netWeightMT) || order.qtyMT) || 0).toFixed(2)} MT</div>
            <div>Gross Weight ${(((totals && totals.grossWeightMT) || order.qtyMT) || 0).toFixed(2)} MT</div>
          </td>
        </tr>
      </table>

      <div style="text-align:center; margin:15px 0; font-size:16px; font-weight:bold;">
        14 DAYS FREE AT DESTINATION PORT<br/>
        <span style="font-size:11px;">${shipment.freightTerms || 'COLLECT'}</span>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:10px;">
        <tr>
          <td style="border:1px solid #333; padding:4px;"><strong>Total No of Containers</strong><br/>${containerCount} x ${containerType === '40' ? "40'" : "20'"}HC</td>
          <td style="border:1px solid #333; padding:4px;"><strong>Movement</strong></td>
          <td style="border:1px solid #333; padding:4px;"><strong>Freight</strong></td>
        </tr>
      </table>
    </div>`;
}

// ─── Packing Certificate ───
function renderPackingCertificate(doc) {
  const { company, buyer, order, shipment, containers, totals, packing } = doc;
  const totalBags = totals?.totalBags || order.totalBags;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <p style="text-align:center; font-weight:bold;">ORIGINAL</p>
      <h2 style="text-align:center; font-size:16px; margin:5px 0;">PACKING CERTIFICATE</h2>

      <table style="width:100%; font-size:11px; line-height:1.8; margin:15px 0;">
        <tr><td style="width:130px; font-weight:bold;">DATE:</td><td>${order.date}</td></tr>
        <tr><td style="font-weight:bold;">SHIPPER:</td><td>${company.name}</td></tr>
        <tr><td style="font-weight:bold;">SHIPPER ADD:</td><td>${company.address}</td></tr>
        <tr><td style="font-weight:bold;">INVOICE #</td><td>${order.invoiceNumber} DATED: ${order.date}</td></tr>
        <tr><td style="font-weight:bold;">QUANTITY:</td><td>${totalBags} BAGS - ${order.qtyMT.toFixed(2)} MT NET WEIGHT AND ${(totals?.grossWeightMT || order.qtyMT + 0.1).toFixed(2)} MT GROSS WEIGHT</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">QUALITY:</td><td>${order.qualityDescription} - HS CODE: ${order.hsCode}</td></tr>
      </table>

      <table style="width:100%; font-size:11px; line-height:1.8;">
        ${containers.map(c => `<tr><td style="width:130px;"></td><td>${c.lotNumber || '—'},</td></tr>`).join('')}
        <tr><td style="font-weight:bold;">BUYER</td><td>${buyer.name}<br/>${buyer.address}, ${buyer.country}</td></tr>
        <tr><td style="font-weight:bold;">PACKING:</td><td>PACKED IN ${order.bagSizeKg || 50} KG IN NEW DOUBLE WOVEN (OUTER) POLYPROPYLENE BAGS OF ${order.bagSizeKg || 50} KG NET EACH</td></tr>
        <tr><td style="font-weight:bold;">PRODUCT ORIGIN:</td><td>PAKISTAN</td></tr>
        ${shipment.blNumber ? `<tr><td style="font-weight:bold;">BL #</td><td>${shipment.blNumber} DATED: ${shipment.blDate || '—'}</td></tr>` : ''}
        ${shipment.vesselName ? `<tr><td style="font-weight:bold;">VESSEL NAME:</td><td>${shipment.vesselName}</td></tr>` : ''}
        <tr><td style="font-weight:bold;">PLACE OF DESTINATION:</td><td>${order.destinationPort}, ${buyer.country}</td></tr>
      </table>

      <p style="margin-top:10px; font-size:11px;">
        TARE WEIGHT OF BAGS PER CONTAINER: ${containers.length > 0 ? ((containers[0].grossWeightKg - containers[0].netWeightKg) / 1000).toFixed(3) : '0.025'} M/TONS<br/>
        NET WEIGHT PER CONTAINER: ${containers.length > 0 ? (containers[0].netWeightKg / 1000).toFixed(3) : (order.qtyMT / (containers.length || 1)).toFixed(3)} M/TONS<br/>
        GROSS WEIGHT PER CONTAINER: ${containers.length > 0 ? (containers[0].grossWeightKg / 1000).toFixed(3) : ((order.qtyMT / (containers.length || 1)) + 0.025).toFixed(3)} M/TONS
      </p>

      ${containers.length > 0 ? `
        <table style="width:80%; border-collapse:collapse; margin:15px 0; font-size:11px;">
          <thead><tr style="background:#f5f5f5;">
            <th style="border:1px solid #333; padding:4px;">S.NO</th>
            <th style="border:1px solid #333; padding:4px;">CONTAINER #</th>
            <th style="border:1px solid #333; padding:4px;">NO OF BAGS</th>
            <th style="border:1px solid #333; padding:4px;">NET WT IN M/TONS</th>
            <th style="border:1px solid #333; padding:4px;">GROSS WT IN M/TONS</th>
          </tr></thead>
          <tbody>
            ${containers.map((c, i) => `<tr>
              <td style="border:1px solid #333; padding:4px; text-align:center;">${i + 1}</td>
              <td style="border:1px solid #333; padding:4px;">${c.containerNo}</td>
              <td style="border:1px solid #333; padding:4px; text-align:center;">${c.bagsCount}</td>
              <td style="border:1px solid #333; padding:4px; text-align:right;">${(c.netWeightKg / 1000).toFixed(2)}</td>
              <td style="border:1px solid #333; padding:4px; text-align:right;">${(c.grossWeightKg / 1000).toFixed(3)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : ''}

      <p style="font-size:11px; margin-top:15px;">WITH REFERENCE TO ABOVE, WE HEREBY CONFIRM THAT THE GROSS, NET AND TARE WEIGHT OF THE CONTAINER IS CORRECT AS MENTIONED ON THE ABOVE BL AND PACKING LIST.</p>

      <div style="margin-top:30px;">
        <p>Name of Signing authority:</p>
        <p style="font-weight:bold;">${company.proprietor}<br/>${company.name}<br/>Proprietor</p>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Statement of Origin (uses same layout as Commercial Invoice with origin text) ───
function renderStatementOfOrigin(doc) {
  const { company, buyer, order, shipment, containers, totals } = doc;
  const totalBags = totals?.totalBags || order.totalBags;
  const ciHtml = renderCommercialInvoice(doc);
  // Append origin declaration text
  const originText = `
    <div style="text-align:center; margin:20px 0; padding:15px; border:2px solid #333;">
      <h3 style="text-decoration:underline;">TEXT FOR STATEMENT OF ORIGIN</h3>
      <p style="font-size:11px; line-height:1.8;">
        We M/s. ${company.name}, "The exporter under Rex reg # ${company.rexNumber} of the products covered by this document declares that, except where otherwise clearly indicated, these products are of Pakistani preferential origin according to rules of origin of the Generalized System of Preferences of the European Union and that the origin criterion met is P."
      </p>
    </div>`;
  return ciHtml.replace('</div>\n    </div>', `${originText}</div>\n    </div>`);
}

// ─── Certificate of Origin (data for KCCI form) ───
function renderCertificateOfOrigin(doc) {
  const { company, buyer, order, shipment, containers, items } = doc;

  const fmtKg = (n) => (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // Build one row per multi-line P.I. item, falling back to a single
  // synthesized row from the order's summary fields. Per-row weight is the
  // item's weight in kg (rice + packaging tare when known).
  const rows = (items && items.length > 0)
    ? items.map((it, idx) => {
        const bagSize = it.bagSizeKg || order.bagSizeKg || 50;
        const bagType = it.bagType || order.bagType || 'PP';
        const bagCount = it.bagCount || (it.qtyMT && bagSize ? Math.round((it.qtyMT * 1000) / bagSize) : 0);
        const grossKg = it.qtyMT * 1000;
        const tarePerBagKg = order.bagWeightGm ? (order.bagWeightGm / 1000) : 0;
        const netKg = grossKg + bagCount * tarePerBagKg;
        const containerLabel = `1X20 FCL ${Math.round(it.qtyMT)} MT`;
        const qualityText = it.qualityDescription
          || `${it.productName || 'Rice'} max 0-${it.brokenPctTarget != null ? it.brokenPctTarget : (order.brokenPctTarget || 2)}% broken, double (silky) polished and sortexed. Product to meet EU regulations at all times. Latest crop.`;
        return {
          label: it.productName || `Item ${idx + 1}`,
          bags: bagCount,
          description: `${containerLabel} ${qualityText}<br/>Packed in ${bagSize}KG bags`,
          weightKg: netKg,
          hsCode: it.hsCode || '',
        };
      })
    : (() => {
        const bagSize = order.bagSizeKg || 50;
        const bagType = order.bagType || 'PP';
        const totalBags = order.totalBags || (order.qtyMT && bagSize ? Math.round((order.qtyMT * 1000) / bagSize) : 0);
        const grossKg = order.qtyMT * 1000;
        return [{
          label: order.brandMarking || order.product || '',
          bags: totalBags,
          description: `${containers.length || 1}X20 FCL ${Math.round(order.qtyMT)} MT ${order.qualityDescription || order.product || ''}<br/>Packed in ${bagSize}KG bags`,
          weightKg: grossKg,
          hsCode: order.hsCode || '',
        }];
      })();

  const totalBags = rows.reduce((s, r) => s + (r.bags || 0), 0);
  const totalWeightKg = rows.reduce((s, r) => s + (r.weightKg || 0), 0);
  const totalNetKg = order.qtyMT ? order.qtyMT * 1000 : totalWeightKg;
  const containerCount = containers && containers.length > 0
    ? containers.length
    : (shipment && shipment.containerCount ? shipment.containerCount : rows.length);

  // HS codes — show all distinct codes across items so multi-line P.I.s with
  // different HS codes per product render correctly.
  const distinctHs = [...new Set(rows.map((r) => r.hsCode).filter(Boolean))];
  const hsLine = distinctHs.length > 0 ? distinctHs.join(', ') : (order.hsCode || '');

  const refNo = company.kcciMembership || '';

  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:780px; margin:0 auto; padding:18px;">

      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="border:1px solid #333; padding:10px; vertical-align:top; width:65%;">
            <strong style="font-size:13px;">${company.name || ''}</strong><br/>
            ${(company.address || '').replace(/\n/g, '<br/>')}
          </td>
          <td style="border:1px solid #333; padding:10px; text-align:right; vertical-align:top; width:35%;">
            <span style="font-size:18px; font-weight:bold;">${refNo}</span>
          </td>
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:10px; vertical-align:top;">
            <strong style="text-transform:uppercase;">${buyer.name || ''}</strong><br/>
            ${(buyer.address || '').replace(/\n/g, '<br/>')}${buyer.country ? `<br/>${buyer.country}` : ''}
          </td>
          <td style="border:1px solid #333; padding:10px; vertical-align:bottom; text-align:right; font-weight:bold;">
            Total Gr. Weight
          </td>
        </tr>
      </table>

      <div style="margin:14px 0 6px; font-weight:bold;">
        BY SEA &nbsp;&nbsp; ${shipment.vesselName || ''}${shipment.voyageNumber ? ` / ${shipment.voyageNumber}` : ''}
      </div>
      <div style="font-weight:bold;">
        BL# : ${shipment.blNumber || ''} &nbsp;&nbsp; Dated : ${shipment.blDate || ''}
      </div>

      <div style="text-align:center; margin:12px 0 6px; font-weight:bold; text-decoration:underline;">
        ${containerCount} X 20' FCL
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td style="padding:8px 6px; vertical-align:top; font-style:italic; width:18%; font-weight:bold;">${r.label}</td>
              <td style="padding:8px 6px; vertical-align:top; width:8%; text-align:right;">${(r.bags || 0).toLocaleString()}</td>
              <td style="padding:8px 6px; vertical-align:top; width:60%; line-height:1.4;">${r.description}</td>
              <td style="padding:8px 6px; vertical-align:top; width:14%; text-align:right; font-weight:bold;">${fmtKg(r.weightKg)} MT</td>
            </tr>
          `).join('')}
          <tr>
            <td colspan="3" style="border-top:1px solid #333; padding:8px 6px; text-align:right; font-weight:bold;">Total Gr. Weight</td>
            <td style="border-top:1px solid #333; padding:8px 6px; text-align:right; font-weight:bold;">${fmtKg(totalWeightKg)}</td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top:10px; padding-left:18%; line-height:1.7;">
        <div><strong>SALES CONTRACT #</strong> ${order.contractNumber || ''}${order.date ? ` Dated: ${order.date}` : ''}</div>
        <div><strong>H.S CODE</strong> &nbsp;&nbsp; # ${hsLine}</div>
        <div><strong>TOTAL BAGS</strong> &nbsp; : ${totalBags.toLocaleString()} BAGS.</div>
        <div><strong>TOTAL NET WT</strong>: ${fmtKg(totalNetKg)} KGS.</div>
      </div>

      <div style="margin-top:30px; text-align:center; font-weight:bold; font-size:13px; line-height:1.5;">
        CERTIFIED THAT THE ABOVE GOODS<br/>
        ARE OF PAKISTANI ORIGIN
      </div>

      <div style="margin-top:50px; text-align:center; line-height:2;">
        <div style="font-weight:bold;">${company.proprietor || ''}</div>
        <div style="font-weight:bold;">PROPRIETOR</div>
        <div style="font-weight:bold;">${company.name || ''}</div>
      </div>

      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Bank Covering Letter ───
function renderBankCoveringLetter(doc) {
  const { company, buyer, order, shipment, containers, notifyParty } = doc;
  const fiNumbers = [shipment.fiNumber, shipment.fiNumber2, shipment.fiNumber3].filter(Boolean);
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <p>Date: ${order.date}</p>
      <p style="margin-top:15px;">${company.bank.name}<br/>${company.bank.branch}<br/>Karachi</p>
      <p style="float:right; margin-top:-40px; font-weight:bold; color:red;">ONLY FOR LODGEMENT</p>
      <div style="clear:both;"></div>
      <h3 style="text-decoration:underline; margin:20px 0;">EXPORT DOCUMENTS AGAINST FI # ${fiNumbers.join(' & ')}</h3>
      <p>Dear Sir,</p>
      <p>Pleased to send you following documents of our consignment against FI # ${fiNumbers.join(' & ')} against ${order.paymentTerms} Basis.</p>

      <table style="width:100%; border-collapse:collapse; margin:20px 0; font-size:11px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="border:1px solid #333; padding:6px;">S.No.</th>
          <th style="border:1px solid #333; padding:6px;">Documents</th>
          <th style="border:1px solid #333; padding:6px;">Document Type</th>
          <th style="border:1px solid #333; padding:6px;">Marks & Nos.</th>
        </tr></thead>
        <tbody>
          <tr><td style="border:1px solid #333; padding:6px;">1</td><td style="border:1px solid #333; padding:6px;">BILL OF LADING</td><td style="border:1px solid #333; padding:6px;">3 Original + NN COPY</td><td style="border:1px solid #333; padding:6px;">${shipment.blNumber} - ${shipment.blDate}</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">2</td><td style="border:1px solid #333; padding:6px;">COMMERCIAL INVOICE</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${order.invoiceNumber}</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">3</td><td style="border:1px solid #333; padding:6px;">PACKING LIST</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${order.invoiceNumber} (${containers.length} X 20 Containers)</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">4</td><td style="border:1px solid #333; padding:6px;">STATEMENT OF ORIGIN</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${order.invoiceNumber}</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">5</td><td style="border:1px solid #333; padding:6px;">FI</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${fiNumbers.join(' & ')}</td></tr>
          ${shipment.gdNumber ? `<tr><td style="border:1px solid #333; padding:6px;">6</td><td style="border:1px solid #333; padding:6px;">GD</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${shipment.gdNumber} - ${shipment.gdDate}</td></tr>` : ''}
        </tbody>
      </table>

      ${(notifyParty?.name) ? `<p>Therefore, you are requested to please endorse the Original Bill of Lading in the name of Notify party: <strong>${notifyParty.name}, ${notifyParty.address || buyer.country}</strong></p>` : ''}

      <div style="margin-top:40px;"><p>Best Regards,</p><p style="font-weight:bold;">${company.name}<br/>Proprietor</p></div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── Buyer Covering Letter ───
function renderBuyerCoveringLetter(doc) {
  const { company, buyer, order, shipment, containers, notifyParty } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <p>Date: ${order.date}</p>
      <p style="margin-top:15px;">${buyer.name}<br/>${buyer.address}<br/>${buyer.country}${buyer.vatNumber ? `<br/>VAT NO: ${buyer.vatNumber}` : ''}</p>

      <h3 style="text-decoration:underline; margin:20px 0;">EXPORT DOCUMENTS AGAINST SALES CONTRACT # ${order.contractNumber} DATED: ${order.date}</h3>
      <p>Dear Sir,</p>
      <p>Pleased to send you following documents of our consignment against Sales Contract # ${order.contractNumber}</p>

      <table style="width:100%; border-collapse:collapse; margin:20px 0; font-size:11px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="border:1px solid #333; padding:6px;">S.No.</th>
          <th style="border:1px solid #333; padding:6px;">Documents</th>
          <th style="border:1px solid #333; padding:6px;">Document Type</th>
          <th style="border:1px solid #333; padding:6px;">Marks & Nos.</th>
          <th style="border:1px solid #333; padding:6px;">Copies</th>
        </tr></thead>
        <tbody>
          <tr><td style="border:1px solid #333; padding:6px;">1</td><td style="border:1px solid #333; padding:6px;">BILL OF LADING ENDORSED</td><td style="border:1px solid #333; padding:6px;">3 Original + NN COPY</td><td style="border:1px solid #333; padding:6px;">${shipment.blNumber}</td><td style="border:1px solid #333; padding:6px;">01</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">2</td><td style="border:1px solid #333; padding:6px;">COMMERCIAL INVOICE</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${order.invoiceNumber}</td><td style="border:1px solid #333; padding:6px;">5</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">3</td><td style="border:1px solid #333; padding:6px;">PACKING LIST & CERTIFICATE</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${containers.length} x 20</td><td style="border:1px solid #333; padding:6px;">5</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">4</td><td style="border:1px solid #333; padding:6px;">STATEMENT OF ORIGIN</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">${order.invoiceNumber}</td><td style="border:1px solid #333; padding:6px;">3</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">5</td><td style="border:1px solid #333; padding:6px;">CERTIFICATE OF ORIGIN</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">—</td><td style="border:1px solid #333; padding:6px;">01</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">6</td><td style="border:1px solid #333; padding:6px;">PHYTOSANITARY CERTIFICATE</td><td style="border:1px solid #333; padding:6px;">Original + Duplicate</td><td style="border:1px solid #333; padding:6px;">—</td><td style="border:1px solid #333; padding:6px;">1</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">7</td><td style="border:1px solid #333; padding:6px;">FUMIGATION CERTIFICATE</td><td style="border:1px solid #333; padding:6px;">Original + Duplicate</td><td style="border:1px solid #333; padding:6px;">${containers.length} x 20</td><td style="border:1px solid #333; padding:6px;">1</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">8</td><td style="border:1px solid #333; padding:6px;">PCSIR AFLATOXIN REPORT</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">—</td><td style="border:1px solid #333; padding:6px;">1</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">9</td><td style="border:1px solid #333; padding:6px;">PCSIR NON GMO REPORT</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">—</td><td style="border:1px solid #333; padding:6px;">1</td></tr>
          <tr><td style="border:1px solid #333; padding:6px;">10</td><td style="border:1px solid #333; padding:6px;">SGS INSPECTION REPORTS</td><td style="border:1px solid #333; padding:6px;">Original</td><td style="border:1px solid #333; padding:6px;">—</td><td style="border:1px solid #333; padding:6px;">1</td></tr>
        </tbody>
      </table>

      <p>THANK YOU AND WAITING FOR YOUR NEXT CONSIGNMENT.</p>
      <div style="margin-top:40px;"><p>Best Regards,</p><p style="font-weight:bold;">${company.name}<br/>Proprietor</p></div>
      ${renderCompanyFooter(company)}
    </div>`;
}

// ─── PCSIR / Lab Test Request ───
function renderLabTestRequest(doc) {
  const { company, order } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <p style="text-align:right;">Date: ${order.date}</p>
      <p>INVOICE NO: ${order.invoiceNumber}</p>

      <p style="margin-top:15px;">To,<br/>P.C.S.I.R,<br/>Karachi.</p>
      <p>Dear Sir,</p>

      <p><strong>Sub: ${order.product} SAMPLE FOR NON GMO REPORT</strong></p>

      <p>Enclosed herewith the Pay order # __________ dated: __________ amount Rs. 10,000/- drawn on ${company.bank.name}, ${company.bank.branch}, Karachi Fee for NON GMO Testing of Rice for Export to EU Country.</p>

      <p style="margin-top:20px;">Kindly issue the NON GMO Certificate as soon as possible.</p>

      <p style="margin-top:15px;">Thanking you,<br/>Yours truly,</p>
      <p style="margin-top:20px;">For: ${company.name},<br/>Proprietor</p>

      <hr style="margin:30px 0; border:none; border-top:2px dashed #ccc;" />

      <p style="text-align:right;">Date: ${order.date}</p>
      <p>Shipper Invoice # ${order.invoiceNumber}</p>

      <p style="margin-top:15px;">To,<br/>Eurofins Dr. Specht Express Testing & Inspection GMBH<br/>Am Neulander Gewerbepark 2<br/>DE - 21079 Hamburg, Germany</p>

      <p><strong>Sub: 01 kg ${order.product} sample for Pesticides Test - INV # ${order.invoiceNumber}</strong></p>

      <p>Dear Sir,</p>
      <p>We are pleased to send one sample of 1 kg rice sample sealed by SGS Pakistan Pvt Ltd for Pesticides test.</p>
      <p>Please share the results to an email "${company.email}".</p>

      <p style="margin-top:15px;">Thanking you,<br/>Yours truly,</p>
      <p style="margin-top:20px;">For: ${company.name},<br/>Proprietor</p>
      ${renderCompanyFooter(company)}
    </div>`;
}

const RENDERERS = {
  'proforma-invoice': renderProformaInvoice,
  'commercial-invoice': renderCommercialInvoice,
  'packing-list': renderPackingList,
  'sales-contract': renderSalesContract,
  'production-plan': renderProductionPlan,
  'bank-fi-request': renderBankFIRequest,
  'export-undertaking': renderExportUndertaking,
  'invoice': renderInvoice,
  'bill-of-lading': renderBillOfLading,
  'packing-certificate': renderPackingCertificate,
  'statement-of-origin': renderStatementOfOrigin,
  'certificate-of-origin': renderCertificateOfOrigin,
  'bank-covering-letter': renderBankCoveringLetter,
  'buyer-covering-letter': renderBuyerCoveringLetter,
  'lab-test-request': renderLabTestRequest,
};

function renderDocument(doc) {
  const renderer = RENDERERS[doc._docType];
  return renderer ? renderer(doc) : renderGenericDocument(doc);
}

// ─── Document Center Component ───

export default function DocumentCenter({ order }) {
  const { addToast } = useApp();
  const [availableDocs, setAvailableDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [generating, setGenerating] = useState(null);
  const printRef = useRef(null);

  useEffect(() => {
    if (!order?.dbId && !order?.id) return;
    const oid = order.dbId || order.id;
    api.get(`/api/export-orders/${oid}/documents/available`)
      .then(res => setAvailableDocs(res?.data?.documents || []))
      .catch(() => { /* document list unavailable — will show empty state */ })
      .finally(() => setLoading(false));
  }, [order?.dbId, order?.id, order?.status]);

  async function handleGenerate(docKey) {
    setGenerating(docKey);
    try {
      const oid = order.dbId || order.id;
      const res = await api.get(`/api/export-orders/${oid}/documents/generate/${docKey}`);
      const doc = res?.data?.document;
      if (doc) {
        doc._docType = docKey;
        setPreviewDoc(doc);
        setPreviewHtml(renderDocument(doc));
      }
    } catch (err) {
      addToast(`Failed to generate document: ${err.message}`, 'error');
    } finally {
      setGenerating(null);
    }
  }

  function handlePrint() {
    // Use the edited DOM content (user may have edited text inline)
    const editedHtml = printRef.current ? printRef.current.innerHTML : previewHtml;
    const printWindow = window.open('', '_blank');
    // The Proforma Invoice carries the most columns (incl. per-item packing),
    // so it prints LANDSCAPE on A4 to use the full width; everything else stays
    // portrait.
    const landscape = previewDoc?._docType === 'proforma-invoice';
    const pageRule = landscape ? '@page { size: A4 landscape; margin: 10mm; }' : '@page { size: A4; margin: 12mm; }';
    // Setting an explicit @page margin suppresses Chrome/Edge/Safari's
    // default print header (date, page title, URL) and footer (page numbers,
    // URL). Firefox honors the same rule. The margin keeps the document
    // visually well-padded without the browser-rendered chrome.
    printWindow.document.write(`
      <html>
        <head>
          <title>${previewDoc?.type || 'Document'} — ${order.id}</title>
          <style>
            ${pageRule}
            html, body { margin: 0; padding: 0; }
            @media print {
              html, body { margin: 0; padding: 0; }
            }
          </style>
        </head>
        <body>
          ${editedHtml}
          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading documents...</div>;
  }

  const readyCount = availableDocs.filter(d => d.ready).length;
  const lockedCount = availableDocs.filter(d => !d.ready).length;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Export Document Center</h3>
            <p className="text-xs text-gray-400 mt-0.5">{readyCount} ready to generate{lockedCount > 0 ? ` · ${lockedCount} need more data` : ''}</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded-full font-medium">
              <CheckCircle className="w-3 h-3" /> {readyCount} Ready
            </span>
            {lockedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-500 rounded-full font-medium">
                <Clock className="w-3 h-3" /> {lockedCount} Pending
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {availableDocs.map((doc, idx) => (
            <div
              key={doc.key}
              className={`rounded-xl border p-4 flex flex-col gap-3 transition-all ${
                doc.ready
                  ? 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-md cursor-pointer'
                  : 'border-gray-100 bg-gray-50/60'
              }`}
              onClick={() => doc.ready && handleGenerate(doc.key)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                    doc.ready ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {idx + 1}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${doc.ready ? 'text-gray-900' : 'text-gray-400'}`}>{doc.label}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {doc.ready
                        ? 'Click to preview & print'
                        : doc.availableFrom >= 9 ? 'Needs BL number'
                        : doc.availableFrom >= 8 ? 'Needs vessel & containers'
                        : 'Needs order data'}
                    </p>
                  </div>
                </div>
                {doc.ready ? (
                  generating === doc.key ? (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0 mt-1" />
                  ) : (
                    <Eye className="w-4 h-4 text-blue-500 flex-shrink-0 mt-1" />
                  )
                ) : (
                  <Clock className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview Modal */}
      {previewDoc && (
        <Modal isOpen={!!previewDoc} onClose={() => setPreviewDoc(null)} title={`${previewDoc.type} — ${order.id}`} size="xl">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <Edit2 className="w-3 h-3" /> Click any text to edit before printing
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setPreviewHtml(renderDocument(previewDoc)); addToast('Document reset to original', 'info'); }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  Reset
                </button>
                <button
                  onClick={handlePrint}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  <Printer className="w-4 h-4" /> Print / Save PDF
                </button>
              </div>
            </div>
            <div
              ref={printRef}
              contentEditable
              suppressContentEditableWarning
              className="bg-white border border-gray-200 rounded-lg overflow-auto max-h-[70vh] p-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
