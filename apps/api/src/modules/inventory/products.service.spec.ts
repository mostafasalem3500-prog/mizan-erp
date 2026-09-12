import { ProductsService, type ProductsRepository } from "./products.service";

function repo(existing: any = null): jest.Mocked<ProductsRepository> {
  return {
    create: jest.fn(async (input) => ({ id: "p1", ...input })),
    findById: jest.fn(),
    findBySku: jest.fn(async () => existing),
    listForOrganization: jest.fn(),
  } as any;
}

describe("ProductsService", () => {
  test("normalizes product text before saving", async () => {
    const products = repo();
    const service = new ProductsService(products);
    await service.createProduct({ organizationId: "o1", sku: " sku-1 ", name: " مياه ", unit: " PCS ", sellingPrice: 2, taxCode: "STANDARD" });
    expect(products.create).toHaveBeenCalledWith(expect.objectContaining({ sku: "SKU-1", name: "مياه", unit: "PCS" }));
  });

  test("rejects duplicate SKU with a clear Arabic message", async () => {
    const service = new ProductsService(repo({ id: "existing" }));
    await expect(service.createProduct({ organizationId: "o1", sku: "SKU-1", name: "مياه", unit: "PCS", sellingPrice: 2, taxCode: "STANDARD" })).rejects.toThrow("كود الصنف مستخدم مسبقًا");
  });

  test("rejects zero or invalid prices", async () => {
    const service = new ProductsService(repo());
    await expect(service.createProduct({ organizationId: "o1", sku: "SKU-1", name: "مياه", unit: "PCS", sellingPrice: 0, taxCode: "STANDARD" })).rejects.toThrow("أكبر من صفر");
  });
});
