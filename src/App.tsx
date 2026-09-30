import { AppRecoveryBoundary } from './workspace/WorkflowRecovery'
import { product } from './product/definition'
import{RouterProvider}from'react-router-dom';import{AppProviders}from'./application/AppProviders';import{browserRouter}from'./app/router';export default function App(){return<AppRecoveryBoundary productName={product.name}><AppProviders><RouterProvider router={browserRouter}/></AppProviders></AppRecoveryBoundary>}
