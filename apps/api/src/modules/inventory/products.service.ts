import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";

export interface CreateProductInput {
  organizationId: string;
  sku: string;
  name: string;
  unit: string; // e.g. "PCS", "KG" — spec band 28 (unit_categories/units); not modeled yet, just a label for now
  sellingPrice: number;
  taxCode: "STANDARD" | "ZERO" | "EXEMPT" | "OUT_OF_SCOPE";
}

export interface ProductRow {
  id: string;
  organizationId: string;
  sku: string;
  name: string;
  unit: string;
  sellingPrice: number;
  taxCode: CreateProductInput["taxCode"];
}

/**
 * Phase 0 scope only — spec band 25 also calls for barcode, category,
 * reorder level, image, and inventory/service/non-inventory typing; band
 * 29-31 add variants, serials, and lots. None of that is modeled yet.
 * This exists to give InventoryService and SalesService/POS a real
 * product to reference, not to be the finished Products module.
 */
export interface ProductsRepository {
  create(input: CreateProductInput): Promise<ProductRow>;
  findById(organizationId: string, productId: string): Promise<ProductRow | null>;
  findBySku(organizationId: string, sku: string): Promise<ProductRow | null>;
  listForOrganization(organizationId: string): Promise<ProductRow[]>;
}

@Injectable()
export class ProductsService {
  constructor(private readonly repo: ProductsRepository) {}

  async createProduct(input: CreateProductInput): Promise<ProductRow> {
    const cleaned = { ...input, sku: input.sku?.trim().toUpperCase(), name: input.name?.trim(), unit: input.unit?.trim() };
    if (!cleaned.sku || !cleaned.name || !cleaned.unit) throw new BadRequestException("اسم الصنف والكود والوحدة مطلوبة");
    if (!Number.isFinite(cleaned.sellingPrice) || cleaned.sellingPrice <= 0) throw new BadRequestException("سعر البيع يجب أن يكون أكبر من صفر");
    if (!(["STANDARD", "ZERO", "EXEMPT", "OUT_OF_SCOPE"] as string[]).includes(cleaned.taxCode)) throw new BadRequestException("تصنيف الضريبة غير صحيح");
    if (await this.repo.findBySku(cleaned.organizationId, cleaned.sku)) throw new ConflictException("كود الصنف مستخدم مسبقًا");
    return this.repo.create(cleaned);
  }

  async getProduct(organizationId: string, productId: string): Promise<ProductRow | null> {
    return this.repo.findById(organizationId, productId);
  }

  async listProducts(organizationId: string): Promise<ProductRow[]> {
    return this.repo.listForOrganization(organizationId);
  }
}
