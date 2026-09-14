/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import{expect,test}from'@playwright/test';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.clear())});
test('opens the command center',async({page})=>{await page.goto('/');await expect(page.getByRole('heading',{name:"FactoryOS command center"})).toBeVisible()});
test('navigates to the connected operations workspace',async({page})=>{await page.goto('/');await page.getByRole('link',{name:'Operations'}).click();await expect(page.getByText(/LIVE WORKSPACE/)).toBeVisible()});
test('renders derived analytics',async({page})=>{await page.goto('/analytics');await expect(page.getByRole('heading',{name:'Operational analytics'})).toBeVisible()});
test("Production order release route is operational",async({page})=>{await page.goto('/production-order');await expect(page.getByRole('heading',{name:"Production order release"})).toBeVisible();await expect(page.getByText(/revision 1/).first()).toBeVisible()})
test("BOM effective revisions route is operational",async({page})=>{await page.goto('/bom-effective');await expect(page.getByRole('heading',{name:"BOM effective revisions"})).toBeVisible();await expect(page.getByText(/revision 1/).first()).toBeVisible()})
test("Routing execution route is operational",async({page})=>{await page.goto('/routing-step');await expect(page.getByRole('heading',{name:"Routing execution"})).toBeVisible();await expect(page.getByText(/revision 1/).first()).toBeVisible()})
test("Machine downtime recovery route is operational",async({page})=>{await page.goto('/machine-downtime');await expect(page.getByRole('heading',{name:"Machine downtime recovery"})).toBeVisible();await expect(page.getByText(/revision 1/).first()).toBeVisible()})
test("Material availability route is operational",async({page})=>{await page.goto('/material-constraint');await expect(page.getByRole('heading',{name:"Material availability"})).toBeVisible();await expect(page.getByText(/revision 1/).first()).toBeVisible()})
test("Scrap disposition route is operational",async({page})=>{await page.goto('/scrap-disposition');await expect(page.getByRole('heading',{name:"Scrap disposition"})).toBeVisible();await expect(page.getByText(/revision 1/).first()).toBeVisible()})
test("Rework release route is operational",async({page})=>{await page.goto('/rework-release');await expect(page.getByRole('heading',{name:"Rework release"})).toBeVisible();await expect(page.getByText(/revision 1/).first()).toBeVisible()})
test("Shift handoff timing route is operational",async({page})=>{await page.goto('/shift-handoff');await expect(page.getByRole('heading',{name:"Shift handoff timing"})).toBeVisible();await expect(page.getByText(/revision 1/).first()).toBeVisible()})
test('retains keyboard-visible product navigation',async({page})=>{await page.goto('/');await page.keyboard.press('Tab');await expect(page.locator(':focus')).toBeVisible()});
