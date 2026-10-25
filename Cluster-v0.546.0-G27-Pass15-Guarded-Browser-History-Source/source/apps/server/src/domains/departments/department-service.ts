import { createDepartmentRepository } from "./department-repository.js";

export function createDepartmentService(deps: any) {
  const repository = createDepartmentRepository(deps.prisma);
  return { list: repository.list };
}
