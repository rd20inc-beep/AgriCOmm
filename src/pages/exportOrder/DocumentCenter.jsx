import React, { useState, useEffect, useRef } from 'react';
import { FileText, Download, Printer, Eye, CheckCircle, Clock, Loader2 } from 'lucide-react';
import api from '../../api/client';
import Modal from '../../components/Modal';

// ─── Document Templates ───
// Each function takes the document JSON and returns printable HTML

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
  const { company, buyer, order, shipment, containers } = doc;
  const totalBags = order.totalBags || Math.round(order.qtyMT * 1000 / order.bagSizeKg);
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
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
            <th style="border:1px solid #333; padding:8px;">S.No.</th>
            <th style="border:1px solid #333; padding:8px;">Brand</th>
            <th style="border:1px solid #333; padding:8px;">Description</th>
            <th style="border:1px solid #333; padding:8px;">Unit Bag<br/>in Kgs</th>
            <th style="border:1px solid #333; padding:8px;">No. of Bags</th>
            <th style="border:1px solid #333; padding:8px;">Weight in MT<br/>(Approx.)</th>
            <th style="border:1px solid #333; padding:8px;">FOB<br/>Price Per MT<br/>(${order.currency})</th>
            <th style="border:1px solid #333; padding:8px;">Total Amount<br/>(${order.currency})</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #333; padding:8px; text-align:center;">1</td>
            <td style="border:1px solid #333; padding:8px; text-align:center; font-weight:bold; color:#d4a017;">${order.brandMarking || '—'}</td>
            <td style="border:1px solid #333; padding:8px;">${order.qualityDescription}</td>
            <td style="border:1px solid #333; padding:8px; text-align:center;">${order.bagSizeKg}</td>
            <td style="border:1px solid #333; padding:8px; text-align:center;">${totalBags.toLocaleString()}</td>
            <td style="border:1px solid #333; padding:8px; text-align:center;">${order.qtyMT.toFixed(3)}</td>
            <td style="border:1px solid #333; padding:8px; text-align:center;">${order.pricePerMT.toFixed(2)}</td>
            <td style="border:1px solid #333; padding:8px; text-align:right;">${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
          </tr>
          <tr style="font-weight:bold;">
            <td colspan="4" style="border:1px solid #333; padding:8px; text-align:center;">Total</td>
            <td style="border:1px solid #333; padding:8px; text-align:center;">${totalBags.toLocaleString()}</td>
            <td style="border:1px solid #333; padding:8px; text-align:center;">${order.qtyMT.toFixed(2)}</td>
            <td style="border:1px solid #333; padding:8px; text-align:center;">$</td>
            <td style="border:1px solid #333; padding:8px; text-align:right;">${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
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
  const totalBags = totals.totalBags || order.totalBags;
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
          <td style="border:1px solid #333; padding:4px 8px;">${shipment.fiNumber || '—'}</td>
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
          <tr>
            <td style="border:1px solid #333; padding:8px; text-align:center; font-weight:bold; font-style:italic; color:#d4a017;">${order.brandMarking || '—'}</td>
            <td style="border:1px solid #333; padding:8px; text-align:center;">${totalBags.toLocaleString()} Bags<br/><br/>${order.qtyMT}<br/><br/>MT</td>
            <td style="border:1px solid #333; padding:8px;">${order.qualityDescription}</td>
            <td style="border:1px solid #333; padding:8px; text-align:center;">${order.pricePerMT.toFixed(2)}</td>
            <td style="border:1px solid #333; padding:8px; text-align:right;">${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
          </tr>
          <tr style="font-weight:bold;">
            <td colspan="4" style="border:1px solid #333; padding:8px; text-align:right;">Total</td>
            <td style="border:1px solid #333; padding:8px; text-align:right;">${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
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
  const { company, buyer, order, shipment, containers, totals } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:16px; margin:10px 0;">ORIGINAL<br/>PACKING LIST</h2>

      <table style="width:100%; margin:15px 0;">
        <tr>
          <td style="vertical-align:top; width:55%;">
            <strong>Name & Address of Consignee:</strong><br/>
            <div style="border:1px solid #333; padding:8px; margin-top:4px;">
              ${buyer.name}<br/>${buyer.address}
              ${buyer.vatNumber ? `<br/>VAT #: ${buyer.vatNumber}` : ''}
              ${buyer.email ? `<br/>Email: ${buyer.email}` : ''}
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
          <td style="border:1px solid #333; padding:4px; font-weight:bold;">Shipment Ports</td>
          <td style="border:1px solid #333; padding:4px;">${order.portOfLoading} to ${order.destinationPort}</td>
          ${shipment.fiNumber ? `<td style="border:1px solid #333; padding:4px; font-weight:bold;">F.I. #</td><td style="border:1px solid #333; padding:4px;">${shipment.fiNumber}</td>` : ''}
        </tr>
        <tr>
          <td style="border:1px solid #333; padding:4px; font-weight:bold;">Shipped by Sea as</td>
          <td style="border:1px solid #333; padding:4px;">${shipment.vesselName || '—'}</td>
          ${shipment.blNumber ? `<td style="border:1px solid #333; padding:4px; font-weight:bold;">BL #</td><td style="border:1px solid #333; padding:4px;">${shipment.blNumber}</td>` : ''}
        </tr>
      </table>

      ${containers.length > 0 ? `
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="border:1px solid #333; padding:6px;">LOT NUMBER</th>
              <th style="border:1px solid #333; padding:6px;">CONTAINER No</th>
              <th style="border:1px solid #333; padding:6px;">DESCRIPTION</th>
              <th style="border:1px solid #333; padding:6px;">PACKING</th>
              <th style="border:1px solid #333; padding:6px;">QUANTITY</th>
              <th style="border:1px solid #333; padding:6px;" colspan="2">WEIGHT (IN KGS)<br/>Gross &nbsp;&nbsp; Net</th>
            </tr>
          </thead>
          <tbody>
            ${containers.map(c => `
              <tr>
                <td style="border:1px solid #333; padding:6px; font-size:10px;">${c.lotNumber || '—'}</td>
                <td style="border:1px solid #333; padding:6px;">${c.containerNo}</td>
                <td style="border:1px solid #333; padding:6px; font-size:10px;">${order.brandMarking ? `<strong>${order.brandMarking}</strong><br/>` : ''}${order.product}</td>
                <td style="border:1px solid #333; padding:6px; font-size:10px;">PACKED IN ${order.bagSizeKg} KGS PP BAG</td>
                <td style="border:1px solid #333; padding:6px; text-align:center;">${c.bagsCount || '—'} Bags</td>
                <td style="border:1px solid #333; padding:6px; text-align:right;">${c.grossWeightKg ? c.grossWeightKg.toLocaleString('en-US', {minimumFractionDigits:2}) : '—'}</td>
                <td style="border:1px solid #333; padding:6px; text-align:right;">${c.netWeightKg ? c.netWeightKg.toLocaleString('en-US', {minimumFractionDigits:2}) : '—'}</td>
              </tr>
            `).join('')}
            <tr style="font-weight:bold;">
              <td colspan="5" style="border:1px solid #333; padding:6px; text-align:right;">Total &gt;&gt;&gt;&gt;&gt;</td>
              <td style="border:1px solid #333; padding:6px; text-align:right;">${(totals.grossWeightMT * 1000).toLocaleString('en-US', {minimumFractionDigits:2})}</td>
              <td style="border:1px solid #333; padding:6px; text-align:right;">${(totals.netWeightMT * 1000).toLocaleString('en-US', {minimumFractionDigits:2})}</td>
            </tr>
          </tbody>
        </table>
      ` : '<p>No containers recorded yet.</p>'}

      <p style="font-style:italic; font-size:11px; margin-top:15px;">
        <em>Certification: Goods are shipped from Pakistan origin</em>
      </p>

      <div style="margin-top:40px; text-align:right;">
        <p style="font-weight:bold;">${company.name}<br/>Proprietor</p>
      </div>
      ${renderCompanyFooter(company)}
    </div>`;
}

function renderGenericDocument(doc) {
  const { company, buyer, order, shipment, containers } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:16px; margin:10px 0;">${doc.type.toUpperCase()}</h2>
      <table style="width:100%; font-size:12px; margin:15px 0;">
        <tr><td style="padding:4px 0; font-weight:bold; width:160px;">Buyer:</td><td>${buyer.name}, ${buyer.country}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Contract No:</td><td>${order.contractNumber}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Product:</td><td>${order.product}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Quantity:</td><td>${order.qtyMT} MT (${order.totalBags} bags x ${order.bagSizeKg} kg)</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Price:</td><td>${order.currency} ${order.pricePerMT.toFixed(2)} per MT ${order.incoterm}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Total:</td><td>${order.currency} ${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">HS Code:</td><td>${order.hsCode}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Payment Terms:</td><td>${order.paymentTerms}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Port of Loading:</td><td>${order.portOfLoading}</td></tr>
        <tr><td style="padding:4px 0; font-weight:bold;">Destination:</td><td>${order.destinationPort}, ${buyer.country}</td></tr>
        ${shipment.vesselName ? `<tr><td style="padding:4px 0; font-weight:bold;">Vessel:</td><td>${shipment.vesselName}</td></tr>` : ''}
        ${shipment.blNumber ? `<tr><td style="padding:4px 0; font-weight:bold;">BL Number:</td><td>${shipment.blNumber}</td></tr>` : ''}
        ${shipment.fiNumber ? `<tr><td style="padding:4px 0; font-weight:bold;">F.I. Number:</td><td>${shipment.fiNumber}</td></tr>` : ''}
      </table>
      <p style="margin-top:10px;"><strong>Quality:</strong><br/>${order.qualityDescription}</p>
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

const RENDERERS = {
  'proforma-invoice': renderProformaInvoice,
  'commercial-invoice': renderCommercialInvoice,
  'packing-list': renderPackingList,
};

function renderDocument(doc) {
  const renderer = RENDERERS[doc._docType];
  return renderer ? renderer(doc) : renderGenericDocument(doc);
}

// ─── Document Center Component ───

export default function DocumentCenter({ order }) {
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
      console.error('Doc generation failed:', err);
    } finally {
      setGenerating(null);
    }
  }

  function handlePrint() {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head><title>${previewDoc?.type || 'Document'} — ${order.id}</title></head>
        <body style="margin:0; padding:0;">
          ${previewHtml}
          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading documents...</div>;
  }

  // Group by availability phase
  const phases = [
    { label: 'Contract & Proforma', from: 2, docs: availableDocs.filter(d => d.availableFrom === 2) },
    { label: 'Production', from: 5, docs: availableDocs.filter(d => d.availableFrom === 5) },
    { label: 'Banking & Compliance', from: 6, docs: availableDocs.filter(d => d.availableFrom === 6) },
    { label: 'Invoice', from: 7, docs: availableDocs.filter(d => d.availableFrom === 7) },
    { label: 'Shipping Documents', from: 8, docs: availableDocs.filter(d => d.availableFrom === 8) },
    { label: 'Origin & Final', from: 9, docs: availableDocs.filter(d => d.availableFrom === 9) },
  ].filter(p => p.docs.length > 0);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">Export Document Center</h3>
        <p className="text-xs text-gray-400 mb-4">Generate, preview, and print all required export documents. Documents become available as the order progresses through the workflow.</p>

        {phases.map(phase => (
          <div key={phase.label} className="mb-6">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] flex items-center justify-center font-bold">{phase.from}</span>
              {phase.label}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {phase.docs.map(doc => (
                <div
                  key={doc.key}
                  className={`rounded-lg border p-4 flex items-start justify-between gap-3 ${doc.ready ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}
                >
                  <div className="flex items-start gap-3">
                    <FileText className={`w-5 h-5 mt-0.5 flex-shrink-0 ${doc.ready ? 'text-blue-600' : 'text-gray-300'}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{doc.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {doc.ready ? 'Ready to generate' : 'Missing shipment data'}
                      </p>
                    </div>
                  </div>
                  {doc.ready && (
                    <button
                      onClick={() => handleGenerate(doc.key)}
                      disabled={generating === doc.key}
                      className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors disabled:opacity-50"
                    >
                      {generating === doc.key ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</>
                      ) : (
                        <><Eye className="w-3 h-3" /> Preview</>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Preview Modal */}
      {previewDoc && (
        <Modal isOpen={!!previewDoc} onClose={() => setPreviewDoc(null)} title={`${previewDoc.type} — ${order.id}`} size="xl">
          <div className="space-y-4">
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handlePrint}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <Printer className="w-4 h-4" /> Print / Save PDF
              </button>
            </div>
            <div
              ref={printRef}
              className="bg-white border border-gray-200 rounded-lg overflow-auto max-h-[70vh] p-2"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
