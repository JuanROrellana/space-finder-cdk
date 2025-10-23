import { SignInOutput, signIn, fetchAuthSession } from "@aws-amplify/auth";
import { Amplify } from "aws-amplify";

Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: 'us-west-2_HpsJKG6N0',
        userPoolClientId: '54nj1vlpa16sc06f6h0datgh',
      },
    },
  });

export class AuthService {
    public async login(username: string, email: string, password: string) {
        const signInOutput: SignInOutput = await signIn({
            username: username,
            password: password,
            options: {
                authFlowType: 'USER_PASSWORD_AUTH'
            }
        });
        return signInOutput;
    }

    public async getCurrentUser() {
        const fetchAuthSessionOutput = await fetchAuthSession();
        return fetchAuthSessionOutput.tokens.idToken?.toString();
    }
}