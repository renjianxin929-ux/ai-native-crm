import { Navigate } from 'react-router-dom';

/** Legacy assistant route is retired; production AI is available only through Sales Agent. */
export default function AIAssistantPage() {
  return <Navigate to="/ai-workspace" replace />;
}
