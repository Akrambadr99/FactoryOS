import { useAppServices } from '../../application/useAppServices';
import { DefinitionList } from '../../components/DefinitionList';
import { PageTitle } from '../../components/PageTitle';
import { SuiteCard } from '../../components/SuiteCard';
export function DataModelPage() { const { product } = useAppServices(); return <main className="suite-page"><PageTitle eyebrow="DOMAIN CONTRACTS" title="Connected data model" detail="Typed records, reference fields and state machines form the product graph."/><div className="suite-grid">{product.kinds.map(kind => <SuiteCard key={kind.key} title={kind.label} detail={'States: ' + kind.states.join(' → ')}><DefinitionList items={kind.fields.map(field => ({ label: field.label, value: field.type + (field.reference ? ' → ' + field.reference : '') + (field.required ? ' · required' : '') }))}/></SuiteCard>)}</div></main>; }
