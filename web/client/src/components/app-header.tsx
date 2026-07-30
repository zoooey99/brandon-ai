import { ReactNode } from "react";
import { User, ChevronDown, CreditCard, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppHeaderProps {
  userName?: string | null;
  rightContent?: ReactNode;
  showBorder?: boolean;
  showSubscriptionManagement?: boolean;
}

export function AppHeader({ userName, rightContent, showBorder = false, showSubscriptionManagement = true }: AppHeaderProps) {
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  const displayName = userName || user?.firstName || user?.email?.split('@')[0];

  return (
    <header className={`w-full flex items-center justify-between px-6 py-4 shrink-0 relative z-50 ${showBorder ? 'border-b border-white/10' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="font-heading font-black text-2xl tracking-tighter uppercase leading-[0.85] text-white">
          Brandon
        </span>
        <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse mt-0.5"></div>
      </div>

      <div className="flex items-center gap-3">
        {rightContent}

        {/* Show skeleton while auth loads to prevent layout shift */}
        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="h-8 w-8 rounded-full bg-zinc-800 animate-pulse" />
            <div className="h-4 w-16 rounded bg-zinc-800 animate-pulse" />
            <div className="h-4 w-4 rounded bg-zinc-800 animate-pulse" />
          </div>
        ) : isAuthenticated && displayName ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors px-3 py-2 rounded-lg hover:bg-zinc-900"
                data-testid="button-profile-menu"
              >
                <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center">
                  <User className="h-4 w-4" />
                </div>
                <span data-testid="text-username">{displayName}</span>
                <ChevronDown className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-zinc-900 border-zinc-800 text-white w-48"
            >
              {showSubscriptionManagement && (
                <DropdownMenuItem
                  className="hover:bg-zinc-800 focus:bg-zinc-800 cursor-pointer"
                  onClick={() =>
                    window.open(
                      "https://billing.stripe.com/p/login/28E5kC6k56or7aV2C7e3e00",
                      "_blank",
                    )
                  }
                  data-testid="menu-manage-subscription"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Manage subscription
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="hover:bg-zinc-800 focus:bg-zinc-800 cursor-pointer text-red-400 focus:text-red-400"
                onClick={() => logout()}
                data-testid="menu-sign-out"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}
