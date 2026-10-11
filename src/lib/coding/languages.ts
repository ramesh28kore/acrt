export type LanguageSpec = { id: string; label: string; piston: string; filename: string };

// Entry class for Java must be Main, so the file name is fixed.
export const LANGUAGES: readonly LanguageSpec[] = [
  { id: "python", label: "Python", piston: "python", filename: "main.py" },
  { id: "javascript", label: "JavaScript", piston: "javascript", filename: "main.js" },
  { id: "c", label: "C", piston: "c", filename: "main.c" },
  { id: "cpp", label: "C++", piston: "c++", filename: "main.cpp" },
  { id: "java", label: "Java", piston: "java", filename: "Main.java" },
];

export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id) as [string, ...string[]];

export function languageSpec(id: string): LanguageSpec | undefined {
  return LANGUAGES.find((l) => l.id === id);
}

// Practice problems and exams run Python only; the Playground uses every language the backend has.
export const PRACTICE_LANGUAGE = "python";

export const STARTER_CODE: Record<string, string> = {
  python: "# Write your solution here\n",
  javascript: "// Write your solution here\n",
  c: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, world!\\n");\n    return 0;\n}\n',
  cpp: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, world!" << std::endl;\n    return 0;\n}\n',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, world!");\n    }\n}\n',
};
