export async function greetActivity(name: string): Promise<string> {
  return `Hello, ${name} from Temporal!`;
}
