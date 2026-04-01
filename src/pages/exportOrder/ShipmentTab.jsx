import React from 'react';
import { Check, Circle, Ship, Anchor } from 'lucide-react';

export default function ShipmentTab({ order, onUpdateShipment, canUpdateShipment }) {
  const shipmentEvents = [
    { label: 'Vessel Booked', value: order.bookingNo, completed: !!order.bookingNo },
    { label: 'Container Loaded', value: order.containerNo, completed: !!order.containerNo },
    { label: 'ETD', value: order.etd, completed: !!order.etd },
    { label: 'Departed (ATD)', value: order.atd, completed: !!order.atd },
    { label: 'ETA', value: order.eta, completed: !!order.eta },
    { label: 'Arrived (ATA)', value: order.ata, completed: !!order.ata },
  ];

  return (
    <div className="space-y-6">
      {/* Shipment Details */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Shipment Details</h3>
          <button
            disabled={!canUpdateShipment}
            onClick={onUpdateShipment}
            className={`inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors ${!canUpdateShipment ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Ship className="w-4 h-4" />
            Update Shipment
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase">Vessel & Carrier</h4>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Vessel Name</span>
              <span className="font-medium text-gray-900">{order.vesselName || '\u2014'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Shipping Line</span>
              <span className="font-medium text-gray-900">{order.shippingLine || '\u2014'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Destination Port</span>
              <span className="font-medium text-gray-900">{order.destinationPort || '\u2014'}</span>
            </div>
          </div>
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase">References</h4>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Booking No</span>
              <span className="font-medium text-gray-900">{order.bookingNo || '\u2014'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Container No</span>
              <span className="font-medium text-blue-700">{order.containerNo || '\u2014'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">BL Number</span>
              <span className="font-medium text-blue-700">{order.blNumber || '\u2014'}</span>
            </div>
          </div>
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase">Dates</h4>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">ETD</span>
              <span className="font-medium text-gray-900">{order.etd || '\u2014'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">ATD</span>
              <span className={`font-medium ${order.atd ? 'text-green-700' : 'text-gray-400'}`}>{order.atd || '\u2014'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">ETA</span>
              <span className="font-medium text-gray-900">{order.eta || '\u2014'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">ATA</span>
              <span className={`font-medium ${order.ata ? 'text-green-700' : 'text-gray-400'}`}>{order.ata || '\u2014'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Shipment Status Timeline */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Shipment Progress</h3>
        <div className="space-y-4">
          {shipmentEvents.map((event, index) => (
            <div key={event.label} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  event.completed ? 'bg-green-500' : 'bg-gray-200'
                }`}>
                  {event.completed ? (
                    <Check className="w-3.5 h-3.5 text-white" />
                  ) : (
                    <Circle className="w-3 h-3 text-gray-400" />
                  )}
                </div>
                {index < shipmentEvents.length - 1 && (
                  <div className={`w-0.5 h-8 ${event.completed ? 'bg-green-300' : 'bg-gray-200'}`} />
                )}
              </div>
              <div className="pt-0.5">
                <p className={`text-sm font-medium ${event.completed ? 'text-gray-900' : 'text-gray-400'}`}>
                  {event.label}
                </p>
                {event.value && (
                  <p className="text-xs text-gray-500 mt-0.5">{event.value}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
