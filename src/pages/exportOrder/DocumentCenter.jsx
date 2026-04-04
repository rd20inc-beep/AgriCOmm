import React, { useState, useEffect, useRef } from 'react';
import { FileText, Download, Printer, Eye, CheckCircle, Clock, Loader2, Edit2 } from 'lucide-react';
import api from '../../api/client';
import { useApp } from '../../context/AppContext';
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

// ─── Sales Contract ───
function renderSalesContract(doc) {
  const { company, buyer, order, shipment, packing } = doc;
  const totalBags = order.totalBags || Math.round(order.qtyMT * 1000 / (order.bagSizeKg || 50));
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:18px; font-style:italic; margin:10px 0;">Sales Contract</h2>

      <table style="width:100%; font-size:12px; line-height:1.8;">
        <tr><td style="width:130px; font-weight:bold; vertical-align:top;">Date:</td><td>${order.date}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Contract #</td><td>${order.contractNumber || order.orderNo}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Buyer:</td><td>${buyer.name}<br/>${buyer.address}<br/>${buyer.country}${buyer.vatNumber ? `<br/>VAT: ${buyer.vatNumber}` : ''}</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Seller:</td><td>${company.name}<br/>${company.address}</td></tr>
        <tr><td style="font-weight:bold;">Quantity:</td><td>About ${order.qtyMT} M/Tons net weight.</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Product:</td><td>${order.qualityDescription}<br/>Packed in ${order.bagSizeKg || 50} kg Strong PP bags. Sound, loyal and merchantable, fit for human consumption at any stage. Free from alive and dead weevils/insects. GMO Free. Latest crop.</td></tr>
        <tr><td style="font-weight:bold;">Quality:</td><td>Aflatoxins, Ochratoxins, Heavy metal and Pesticide residues are in line with EU law.</td></tr>
        <tr><td style="font-weight:bold;">Price:</td><td>@ ${order.currency} ${order.pricePerMT.toFixed(2)} per metric ton ${order.incoterm} ${order.portOfLoading || 'Karachi'}, Pakistan</td></tr>
        <tr><td style="font-weight:bold;">Total Amount:</td><td>${order.currency} ${order.contractValue.toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
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
  const totalBags = order.totalBags || Math.round(order.qtyMT * 1000 / (order.bagSizeKg || 50));
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
          <tr>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${containers.length || '—'}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${order.brandMarking || '—'}</td>
            <td style="border:1px solid #333; padding:6px;">${order.qualityDescription}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${order.brokenPctTarget || '—'}%</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${order.qtyMT.toFixed(3)}</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${order.bagSizeKg || 50} KGS PP BAG</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${totalBags.toLocaleString()}</td>
          </tr>
          <tr style="font-weight:bold;">
            <td colspan="4" style="border:1px solid #333; padding:6px; text-align:right;">Total</td>
            <td style="border:1px solid #333; padding:6px; text-align:center;">${order.qtyMT.toFixed(3)}</td>
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
              <h4 style="text-align:center; font-weight:bold; margin:0 0 8px 0;">${order.product || 'BASMATI WHITE RICE'}</h4>
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
        <tr><td style="font-weight:bold;">Delivery Terms</td><td>${order.incoterm} - ${order.incoterm === 'FOB' ? 'Free on Board' : order.incoterm === 'CIF' ? 'Cost Insurance Freight' : order.incoterm}</td></tr>
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
        <tbody><tr>
          <td style="border:1px solid #333; padding:6px;">${order.hsCode}</td>
          <td style="border:1px solid #333; padding:6px;">${order.product}</td>
          <td style="border:1px solid #333; padding:6px;">${order.qtyMT}</td>
          <td style="border:1px solid #333; padding:6px;">MT</td>
          <td style="border:1px solid #333; padding:6px;">PAKISTAN</td>
          <td style="border:1px solid #333; padding:6px;">${order.currency} ${order.pricePerMT.toFixed(2)}</td>
        </tr></tbody>
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

      <p>The said export transaction relates to sale of <u>${order.product}</u> for a value of <u>${order.currency} ${order.contractValue.toLocaleString()}</u> with our client <u>${buyer.name}, ${buyer.country}</u> as per mutually agreed contract / Proforma Invoice No. <u>${order.invoiceNumber}</u> dated <u>${order.date}</u> with payment term <u>${order.paymentTerms}</u>.</p>

      <p>We are very much satisfied with the credentials, sound financial standing and good repute of our client (the importer/foreign buyer/consignee) and confirm their bona fide.</p>

      <p>I / We further confirm that:</p>
      <ol style="line-height:2; font-size:11px;">
        <li>The merchandise being exported falls under HS Code Number(s): <u>${order.hsCode}</u>, is freely exportable / not subject to export license / does not contravene any of the provision of the aforesaid rules and regulations.</li>
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
  const totalBags = order.totalBags || Math.round(order.qtyMT * 1000 / (order.bagSizeKg || 50));
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
        <tbody><tr>
          <td style="border:1px solid #333; padding:12px; text-align:center; font-weight:bold; color:#d4a017;">${order.brandMarking || '—'}</td>
          <td style="border:1px solid #333; padding:12px; text-align:center;">${totalBags.toLocaleString()} Bags<br/><br/>${order.qtyMT} MT</td>
          <td style="border:1px solid #333; padding:12px;">${order.qualityDescription}<br/><br/>TOTAL BAGS &nbsp; ; &nbsp; ${totalBags.toLocaleString()} Bags<br/>GROSS WEIGHT : ${(totals?.grossWeightMT || order.qtyMT + 0.1).toFixed(2)} MT<br/>NET WEIGHT &nbsp; : ${order.qtyMT.toFixed(2)} MT</td>
        </tr></tbody>
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
  const { company, buyer, order, shipment, containers, totals } = doc;
  return `
    <div style="font-family: Arial, sans-serif; font-size:11px; max-width:800px; margin:0 auto; padding:10px;">
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="border:2px solid #333; padding:10px; width:50%; vertical-align:top;">
            <strong>SHIPPER</strong><br/>
            ${company.name}<br/>${company.address}<br/>
            TEL ${company.phone} FAX: ${company.fax || '—'}
          </td>
          <td style="border:2px solid #333; padding:10px; width:50%; vertical-align:top;">
            <strong style="font-size:14px;">BILL OF LADING FORMAT</strong><br/>
            FROM<br/><strong>${company.name}</strong><br/>
            <strong>BOOKING NO: ${shipment.bookingNo || '—'}</strong>
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px; vertical-align:top;">
            <strong style="text-decoration:underline;">TO THE ORDER OF</strong><br/>
            ${company.bank.name}<br/>${company.bank.branch},<br/>KARACHI, PAKISTAN
            ${shipment.fiNumber ? `<br/><br/>F.I: ${shipment.fiNumber}` : ''}
          </td>
          <td style="border:2px solid #333; padding:10px; vertical-align:top;" rowspan="2">
            <strong>PLACE OF RECEIPT:</strong><br/>${order.portOfLoading || 'Karachi - Pakistan'}
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px; vertical-align:top;">
            <strong style="text-decoration:underline;">NOTIFY PARTY:</strong><br/>
            ${(doc.notifyParty?.name) ? `${doc.notifyParty.name}<br/>${doc.notifyParty.address || ''}${doc.notifyParty.phone ? `<br/>TEL: ${doc.notifyParty.phone}` : ''}${doc.notifyParty.email ? ` EMAIL: ${doc.notifyParty.email}` : ''}` : `${buyer.name}<br/>${buyer.address}<br/>${buyer.country}${buyer.vatNumber ? `<br/>VAT #: ${buyer.vatNumber}` : ''}${buyer.phone ? `<br/>TEL: ${buyer.phone}` : ''} ${buyer.email ? `EMAIL: ${buyer.email}` : ''}`}
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px;">
            <strong>VESSEL AND VOYAGE NO:</strong><br/>${shipment.vesselName || '—'}${shipment.voyageNumber ? ' V.' + shipment.voyageNumber : ''}
          </td>
          <td style="border:2px solid #333; padding:10px;">
            <strong>PLACE OF DELIVERY</strong><br/>${order.destinationPort}, ${buyer.country}
          </td>
        </tr>
        <tr>
          <td style="border:2px solid #333; padding:10px;">
            <strong>PORT OF LOADING</strong><br/>${order.portOfLoading || 'Karachi, Pakistan'}
          </td>
          <td style="border:2px solid #333; padding:10px;">
            <strong>PORT OF DISCHARGE</strong><br/>${order.destinationPort}
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
            ${containers.length} x ${containers[0]?.containerType === '40ft' ? '40' : '20'} Container containing ${totals?.totalBags || order.totalBags} bags<br/>
            ${order.qualityDescription}<br/>
            Sales contract # ${order.contractNumber} Dated ${order.date}<br/>
            HS code ${order.hsCode}<br/>
            Net Weight ${(totals?.netWeightMT || order.qtyMT).toFixed(2)} MT<br/>
            Gross Weight ${(totals?.grossWeightMT || order.qtyMT + 0.1).toFixed(2)} MT
          </td>
        </tr>
      </table>

      ${containers.length > 0 ? `
        <table style="width:100%; border-collapse:collapse; margin-top:10px; font-size:10px;">
          <tr><td colspan="2" style="border:2px solid #333; padding:6px; font-weight:bold;">CONTAINER</td></tr>
          ${containers.map(c => `
            <tr>
              <td style="border:1px solid #333; padding:6px; width:30%;">${c.containerNo}</td>
              <td style="border:1px solid #333; padding:6px;">${(c.netWeightKg / 1000).toFixed(0)} Mts of ${order.product} Packed in ${order.bagSizeKg} kgs PP bag total ${c.bagsCount} Bags<br/>LOT # ${c.lotNumber || '—'}</td>
            </tr>
          `).join('')}
        </table>
      ` : ''}

      <div style="text-align:center; margin:15px 0; font-size:16px; font-weight:bold;">
        14 DAYS FREE AT DESTINATION PORT<br/>
        <span style="font-size:11px;">${shipment.freightTerms || 'FREIGHT COLLECT'}</span>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:10px;">
        <tr>
          <td style="border:1px solid #333; padding:4px;"><strong>Total No of Containers</strong><br/>${containers.length} x ${containers[0]?.containerType === '40ft' ? "40'" : "20'"}HC</td>
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
  const { company, buyer, order, shipment, containers, totals } = doc;
  const totalBags = totals?.totalBags || order.totalBags;
  return `
    <div style="font-family: Arial, sans-serif; font-size:12px; max-width:800px; margin:0 auto; padding:20px;">
      ${renderHeader(company)}
      <h2 style="text-align:center; font-size:16px; margin:10px 0;">CERTIFICATE OF ORIGIN — DATA</h2>
      <p style="text-align:center; font-size:11px; color:#666;">(Use this data to fill the KCCI Certificate of Origin form)</p>

      <table style="width:100%; font-size:11px; line-height:2; margin-top:15px;">
        <tr><td style="width:200px; font-weight:bold;">Exporter:</td><td>${company.name}<br/>${company.address}</td></tr>
        <tr><td style="font-weight:bold;">Consignee:</td><td>${buyer.name}<br/>${buyer.address}<br/>${buyer.country}${buyer.vatNumber ? `<br/>VAT #: ${buyer.vatNumber}` : ''}${buyer.email ? `<br/>Email: ${buyer.email}` : ''}</td></tr>
        <tr><td style="font-weight:bold;">Exporter's Membership #:</td><td>${company.kcciMembership || '—'}</td></tr>
        <tr><td style="font-weight:bold;">Transport:</td><td>BY SEA &nbsp; ${shipment.vesselName || '—'}<br/>BILL OF LADING # ${shipment.blNumber || '—'} DTD: ${shipment.blDate || '—'}</td></tr>
        <tr><td style="font-weight:bold;">Marks & Numbers:</td><td style="font-weight:bold; color:#d4a017;">${order.brandMarking || '—'}</td></tr>
        <tr><td style="font-weight:bold;">Number of Packages:</td><td>${totalBags} BAGS</td></tr>
        <tr><td style="font-weight:bold; vertical-align:top;">Description of Goods:</td><td>
          ${containers.length} x ${containers[0]?.containerType === '40ft' ? '40' : '20'}' FCL<br/>
          ${order.qualityDescription}<br/>
          ${containers.map(c => c.lotNumber).filter(Boolean).join(',<br/>')}<br/><br/>
          SALES CONTRACT # ${order.contractNumber} DTD: ${order.date}<br/>
          H.S CODE # ${order.hsCode}<br/>
          TOTAL BAGS: ${totalBags}<br/>
          TOTAL NET WT: ${order.qtyMT.toFixed(3)} MT
        </td></tr>
        <tr><td style="font-weight:bold;">Gross Weight:</td><td>${(totals?.grossWeightMT || order.qtyMT + 0.1).toFixed(3)} MT</td></tr>
        <tr><td style="font-weight:bold;">Country of Origin:</td><td>PAKISTAN</td></tr>
      </table>

      <div style="margin-top:20px; padding:10px; border:2px solid #333; text-align:center; font-weight:bold;">
        CERTIFIED THAT THE ABOVE GOODS ARE OF PAKISTANI ORIGIN
      </div>

      <div style="margin-top:30px;">
        <p>Name: <strong>${company.proprietor}</strong></p>
        <p>Designation: <strong>PROPRIETOR</strong></p>
        <p>Company: <strong>${company.name}</strong></p>
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
    printWindow.document.write(`
      <html>
        <head><title>${previewDoc?.type || 'Document'} — ${order.id}</title></head>
        <body style="margin:0; padding:0;">
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
