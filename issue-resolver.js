import fs from "fs"
import path from "path"
import OpenAI from 'openai'
import { findImplementationFile } from "./helpers.js"

class IssueResolver {
    constructor(messages, apiKey = process.env["OPENAI_API_KEY"]) {
        this.openai = new OpenAI({
            apiKey: apiKey
        });

        this.messages = this.groupMessagesByFile(messages)
    }
    
    groupMessagesByFile(messages){
        return messages.reduce((accumulator, message) => {
            // Messages are in the format "file:line: warning: message"
            const [file, line, warning, ...rest] = message.split(":")
            const key = `${file}`
            if(!accumulator[key]) accumulator[key] = []
            accumulator[key].push(`${line}: ${rest.join(":").trim()}`)
            return accumulator
        }, {})
    }

    constructPrompt(file, messages){
        console.log(`📄 Constructing prompt for file ${file}`)
        const fileContents = fs.readFileSync(file).toString()
        const implementationFile = findImplementationFile(file)
        let implementationFileContents
        if(implementationFile){
            implementationFileContents = fs.readFileSync(implementationFile).toString()
        }
        const filename = path.basename(file)
        const promptIntro = `There are issues with the documentation in a C++ file (${filename}):\n\n\`\`\`cpp\n${fileContents}\n\`\`\``
        const promptWarnings = `The following warnings are generated by doxygen. They are in the format 'line: warning': \n\n\`\`\`\n${messages.join("\n")}\n\`\`\``
        const promptImplementation = implementationFile ? `Here is the corresponding implementation file for reference:\n\n\`\`\`cpp\n${implementationFileContents}\n\`\`\`` : ""
        const promptImplementationHint = implementationFile ? ` When adding missing documentation, consult the implementation file to enhance quality and usefulness.` : ""
        const promptOutro = `Please fix the issues. Don't touch the code itself.${promptImplementationHint} Print the whole file (${filename}) including those fixes as a code block without any extra text or explanations.`
        const constructedPrompt = `${promptIntro}\n\n${promptWarnings}\n\n${promptImplementation}\n\n${promptOutro}`
        return constructedPrompt
    }

    async getResolvedFile(file){
        const messages = this.messages[file]
        const prompt = this.constructPrompt(file, messages)
        try {
            const chatCompletion = await this.openai.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'gpt-4',
            });
            const response = chatCompletion.choices[0].message.content
            // Remove anything that comes before the first code block denoted by ``` if there is one
            const codeBlockIndex = response.indexOf("```")
            const result = codeBlockIndex > 0 ? response.substring(codeBlockIndex) : response
            // Strip ```cpp from the beginning and end
            return result.replace("```cpp\n", "").replace("```", "")
        } catch (error) {
            console.error(`❌ Error resolving issues. ${error.message}`)
            return null
        }
    }

    async resolve() {
        let result = true

        for (const file of Object.keys(this.messages)) {
            const resolvedFile = await this.getResolvedFile(file)
            if(resolvedFile){
                fs.writeFileSync(file, resolvedFile)
            } else {
                result = false
            }
        }
        return result
    }
}

export default IssueResolver