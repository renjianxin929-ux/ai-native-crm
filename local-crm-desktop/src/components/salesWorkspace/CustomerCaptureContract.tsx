import { CUSTOMER_CAPTURE_CONTRACT } from '../../lib/salesWorkspace/customerCaptureContract';

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
