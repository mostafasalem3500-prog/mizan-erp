import { ConflictException } from "@nestjs/common";
import { BranchesService, BranchesRepository } from "./branches.service";

describe("BranchesService (spec band 6)", () => {
  function makeRepo(existingCodes: Record<string, string[]> = {}) {
    const created: any[] = [];
    const repo: BranchesRepository = {
      codeExistsForOrganization: jest.fn().mockImplementation(async (orgId: string, code: string) =>
        (existingCodes[orgId] ?? []).includes(code),
      ),
      create: jest.fn().mockImplementation(async (input) => {
        const row = { id: `branch-${created.length + 1}`, isActive: true, ...input };
        created.push(row);
        return row;
      }),
      listForOrganization: jest.fn().mockImplementation(async (orgId: string) =>
        created.filter((b) => b.organizationId === orgId),
      ),
    };
    return { repo, created };
  }

  test("rejects a duplicate branch code within the same organization", async () => {
    const { repo } = makeRepo({ "org-1": ["01"] });
    const service = new BranchesService(repo);

    await expect(
      service.createBranch({ organizationId: "org-1", code: "01", name: "Jeddah Branch" }),
    ).rejects.toThrow(ConflictException);
  });

  test("allows the SAME branch code across two DIFFERENT organizations", async () => {
    const { repo } = makeRepo({ "org-1": ["01"] });
    const service = new BranchesService(repo);

    const branch = await service.createBranch({
      organizationId: "org-2",
      code: "01",
      name: "Riyadh Branch",
    });

    expect(branch.organizationId).toBe("org-2");
    expect(branch.code).toBe("01");
  });

  test("lists only branches belonging to the requested organization", async () => {
    const { repo } = makeRepo();
    const service = new BranchesService(repo);

    await service.createBranch({ organizationId: "org-1", code: "01", name: "A" });
    await service.createBranch({ organizationId: "org-1", code: "02", name: "B" });
    await service.createBranch({ organizationId: "org-2", code: "01", name: "C" });

    const org1Branches = await service.listBranches("org-1");
    expect(org1Branches).toHaveLength(2);
    expect(org1Branches.every((b) => b.organizationId === "org-1")).toBe(true);
  });
});
