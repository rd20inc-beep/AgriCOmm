import React from 'react';
import { Check } from 'lucide-react';
import { workflowSteps } from './constants';

export default function WorkflowTimeline({ order }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between overflow-x-auto">
        {workflowSteps.map((step, index) => {
          const isCompleted = order.currentStep > step.step;
          const isCurrent = order.currentStep === step.step;
          const isUpcoming = order.currentStep < step.step;
          const daysSinceCreated = Math.floor((new Date() - new Date(order.createdAt)) / (1000 * 60 * 60 * 24));
          const isOverdue = isCurrent && daysSinceCreated > 14 && step.step >= 2 && step.step <= 6;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center min-w-[80px]">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    isCompleted
                      ? 'bg-green-500 text-white'
                      : isCurrent
                      ? isOverdue
                        ? 'bg-red-500 text-white ring-4 ring-red-100 animate-pulse'
                        : 'bg-blue-500 text-white ring-4 ring-blue-100 animate-pulse'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {isCompleted ? <Check className="w-4 h-4" /> : step.step}
                </div>
                <span className={`text-xs mt-1.5 text-center leading-tight ${
                  isCompleted ? 'text-green-600 font-medium' : isCurrent ? (isOverdue ? 'text-red-600 font-medium' : 'text-blue-600 font-medium') : 'text-gray-400'
                }`}>
                  {step.label}
                </span>
              </div>
              {index < workflowSteps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${
                  isCompleted ? 'bg-green-400' : 'bg-gray-200'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
