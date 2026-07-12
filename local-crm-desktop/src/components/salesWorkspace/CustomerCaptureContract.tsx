export type CustomerCaptureInputKind = 'text' | 'image' | 'document';

export const CUSTOMER_CAPTURE_CONTRACT: Readonly<Record<CustomerCaptureInputKind, { readonly enabled: true; readonly processing: 'future_pipeline_only' }>> = Object.freeze({
  text: { enabled: true, processing: 'future_pipeline_only' },
  image: { enabled: true, processing: 'future_pipeline_only' },
  document: { enabled: true, processing: 'future_pipeline_only' },
});

export function CustomerCaptureContract() {
  return (
    <details className="card sales-capture-contract" aria-label="Customer capture entry">
      <summary>Customer Capture（future contract）</summary>
      <p>文本、图片和文档输入已预留给未来 capture pipeline。当前不读取内容、不做 OCR 或模型处理、不发起 Provider 调用，也不写入 CRM。</p>
      <div className="sales-capture-grid">
        {Object.entries(CUSTOMER_CAPTURE_CONTRACT).map(([kind, contract]) => <div className="detail-item" key={kind}><div className="label">{kind}</div><div className="value">{contract.enabled ? 'Contract ready' : 'Unavailable'}</div><small>No processing · No DB Write</small></div>)}
      </div>
    </details>
  );
}
